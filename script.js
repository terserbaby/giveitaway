const SUPABASE_URL = 'https://qiiidsisupvvelshbegr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpaWlkc2lzdXB2dmVsc2hiZWdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzOTI4ODUsImV4cCI6MjA5Njk2ODg4NX0.tnGKZtq27wqBG9QQQgVzYw57f5KmYWy-hd6d5C6uK-k';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
});

const mainContainer = document.getElementById('main-container');
const emptyStateContainer = document.getElementById('empty-state-container');
const clickBtn = document.getElementById('click-btn');
const winnerDisplay = document.getElementById('winner-display');
const winnerHeaderEl = document.getElementById('winner-header');
const winnerNameEl = document.getElementById('winner-name');
const claimForm = document.getElementById('claim-form');
const submitNameBtn = document.getElementById('submit-name-btn');

const urlParams = new URLSearchParams(window.location.search);
const giveawayId = urlParams.get('giveaway');

let isGameOver = false;
let globalAddonState = {};
let formFieldsData = [];
let customMessage = null;
let restrictTime = false;
let restrictTimeMessage = null;

let sessionId = localStorage.getItem('giveaway_session_id');
if (!sessionId) {
    sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    localStorage.setItem('giveaway_session_id', sessionId);
}

function showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.getElementById('toast-container').appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function showError(msg) { showToast(msg.startsWith('❌') ? msg : '❌ ' + msg); }

function shake(el) {
    el.style.transform = 'translateX(-10px)';
    setTimeout(() => el.style.transform = 'translateX(10px)', 50);
    setTimeout(() => el.style.transform = 'translateX(0)', 100);
}

function timeAgo(dateString) {
    const seconds = Math.floor((new Date() - new Date(dateString)) / 1000);
    const intervals = [[31536000, 'year'], [2592000, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
    for (const [secs, label] of intervals) {
        const n = Math.floor(seconds / secs);
        if (n >= 1) return `${n} ${label}${n > 1 ? 's' : ''}`;
    }
    return seconds < 10 ? 'just now' : `${Math.floor(seconds)} seconds`;
}

// Shared canvas for text measurement, debounced resize
const _titleCanvas = document.createElement('canvas');
const _titleCtx = _titleCanvas.getContext('2d');
function adjustTitles() {
    document.querySelectorAll('.title').forEach(el => {
        el.style.fontSize = '';
        const parent = el.parentElement;
        if (!parent) return;
        const style = getComputedStyle(el);
        const pStyle = getComputedStyle(parent);
        const maxW = parent.clientWidth - parseFloat(pStyle.paddingLeft) - parseFloat(pStyle.paddingRight);
        const words = (el.textContent || '').split(/\s+/).filter(Boolean);
        if (!words.length) return;
        let size = parseFloat(style.fontSize);
        const getMax = (sz) => {
            _titleCtx.font = `${style.fontWeight} ${sz}px ${style.fontFamily}`;
            return Math.max(...words.map(w => _titleCtx.measureText(w).width));
        };
        while (getMax(size) > maxW && size > 12) size -= 1;
        el.style.fontSize = size + 'px';
    });
}
let _resizeTimer;
window.addEventListener('resize', () => { clearTimeout(_resizeTimer); _resizeTimer = setTimeout(adjustTitles, 100); });

function initAutocomplete(input, suggestionsBox) {
    let debounceTimer;
    input.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        const query = e.target.value.trim();
        if (input.dataset.selectedAddress !== query) input.dataset.selectedAddress = '';
        else return;
        if (query.length < 3) { suggestionsBox.classList.add('hidden'); return; }
        debounceTimer = setTimeout(async () => {
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`);
                const data = await res.json();
                if (data.length > 0) {
                    suggestionsBox.innerHTML = data.map(p =>
                        `<div class="suggestion-item" data-address="${p.display_name.replace(/"/g, '&quot;')}" style="padding:12px;border-bottom:1px solid rgba(255,255,255,0.1);cursor:pointer;color:white;">${p.display_name}</div>`
                    ).join('');
                    suggestionsBox.classList.remove('hidden');
                    suggestionsBox.querySelectorAll('.suggestion-item').forEach(item => {
                        item.addEventListener('mouseover', () => item.style.background = 'rgba(255,255,255,0.1)');
                        item.addEventListener('mouseout', () => item.style.background = '');
                        item.addEventListener('click', () => {
                            const addr = item.dataset.address;
                            input.value = addr;
                            input.dataset.selectedAddress = addr;
                            suggestionsBox.classList.add('hidden');
                            input.dispatchEvent(new Event('input'));
                        });
                    });
                } else {
                    suggestionsBox.innerHTML = '<div style="padding:12px;color:#94A3B8;">No results found...</div>';
                    suggestionsBox.classList.remove('hidden');
                }
            } catch (err) { console.error('Nominatim error', err); }
        }, 600);
    });
}

// Single global click listener to close suggestions
document.addEventListener('click', (e) => {
    document.querySelectorAll('[id^="sug-"]').forEach(box => {
        const inputId = box.id.replace('sug-', 'input-');
        const inp = document.getElementById(inputId);
        if (inp && !inp.contains(e.target) && !box.contains(e.target)) box.classList.add('hidden');
    });
});

async function validateAndInit(attempt = 1) {
    adjustTitles();
    if (!giveawayId) return;
    try {
        const { data, error } = await supabaseClient
            .from('giveaways').select('title, form_fields, custom_message, status, restrict_time, restrict_time_message')
            .eq('id', giveawayId).maybeSingle();
        if (error || !data) {
            // Retry up to 3 times with increasing delay
            if (attempt < 3) {
                setTimeout(() => validateAndInit(attempt + 1), attempt * 2000);
            }
            return;
        }

        formFieldsData = data.form_fields || [];
        customMessage = data.custom_message;
        restrictTime = data.restrict_time || 'none';
        restrictTimeMessage = data.restrict_time_message;
        if (data.title) document.querySelector('#main-container .title').textContent = data.title.toUpperCase();

        emptyStateContainer.classList.add('hidden');
        mainContainer.classList.remove('hidden');
        adjustTitles();
        setTimeout(adjustTitles, 50);

        supabaseClient.channel('public:first_to_click:' + giveawayId)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'first_to_click', filter: 'giveaway_id=eq.' + giveawayId }, () => checkWinner())
            .subscribe();

        checkWinner();

        // Fallback poll every 10s in case Realtime drops
        setInterval(() => { if (!isGameOver) checkWinner(); }, 10000);
    } catch (err) {
        console.error(err);
        if (attempt < 3) setTimeout(() => validateAndInit(attempt + 1), attempt * 2000);
    }
}

let progressiveSetupDone = false;
function setupProgressiveDisclosure() {
    if (progressiveSetupDone) return;
    progressiveSetupDone = true;

    submitNameBtn.classList.remove('hidden');
    submitNameBtn.classList.add('winner-display');
    globalAddonState = {};

    const panelStyle = 'background:rgba(255,255,255,0.05);padding:20px;border-radius:12px;text-align:left;color:#f1f5f9;border:1px solid rgba(255,255,255,0.1);';

    const parts = formFieldsData.map((field, i) => {
        let inner = '';
        if (field.type === 'text' || field.type === 'address') {
            inner = `
                <p style="color:#94A3B8;margin-bottom:10px;font-weight:700;text-align:left;">${field.label}</p>
                <input type="text" id="input-${field.id}" class="dynamic-input field-element" data-index="${i}" data-type="${field.type}" placeholder="${field.placeholder}" autocomplete="off" style="width:100%;padding:12px;border-radius:8px;background:rgba(0,0,0,0.5);color:white;border:1px solid rgba(255,255,255,0.2);font-family:'Outfit',sans-serif;font-size:1.1rem;box-sizing:border-box;" required>
                ${field.type === 'address' ? `<div id="sug-${field.id}" class="hidden" style="position:absolute;width:100%;background:#0F172A;border:1px solid rgba(255,255,255,0.2);border-radius:8px;z-index:50;max-height:250px;overflow-y:auto;text-align:left;margin-top:5px;box-shadow:0 10px 25px rgba(0,0,0,0.5);"></div>` : ''}
            `;
        } else if (field.type === 'entree_select') {
            inner = `<div style="${panelStyle}">
                <h3 style="margin-top:0;color:#f59e0b;margin-bottom:15px;">${field.label}</h3>
                <select id="input-${field.id}" class="dynamic-select field-element" data-index="${i}" data-type="${field.type}" style="width:100%;padding:12px;border-radius:8px;background:rgba(0,0,0,0.5);color:white;border:1px solid rgba(255,255,255,0.2);font-family:'Outfit',sans-serif;font-size:1.1rem;margin-bottom:20px;">
                    ${field.entrees.map((e, idx) => `<option value="${idx}">${e.name}</option>`).join('')}
                </select>
                <div id="cust-${field.id}" class="hidden" style="margin-bottom:10px;"></div>
            </div>`;
        } else if (field.type === 'counter_group') {
            globalAddonState[field.id] = { total: 0, items: {}, max: field.max_total, error_message: field.error_message };
            inner = `<div style="${panelStyle}">
                <h3 style="margin-top:0;color:#ef4444;margin-bottom:15px;">${field.title} (Max ${field.max_total})</h3>
                <div class="addon-group-container field-element" data-index="${i}" data-type="${field.type}" data-group-id="${field.id}" data-max="${field.max_total}" style="text-align:left;">
                    ${field.items.map(item => {
                        const safeId = item.replace(/[^a-zA-Z0-9]/g, '');
                        return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;background:rgba(0,0,0,0.2);padding:8px 12px;border-radius:8px;">
                            <span style="font-size:0.95rem;color:white;">${item}</span>
                            <div style="display:flex;align-items:center;">
                                <button type="button" class="addon-btn minus" data-group="${field.id}" data-item="${item}" style="width:30px;height:30px;border-radius:5px;background:rgba(255,255,255,0.1);border:none;color:white;cursor:pointer;font-size:1.2rem;line-height:1;">-</button>
                                <span class="addon-count" id="count-${field.id}-${safeId}" style="margin:0 15px;width:10px;text-align:center;font-weight:bold;color:white;">0</span>
                                <button type="button" class="addon-btn plus" data-group="${field.id}" data-item="${item}" style="width:30px;height:30px;border-radius:5px;background:#ef4444;border:none;color:white;cursor:pointer;font-size:1.2rem;line-height:1;">+</button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }
        return `<div class="dynamic-field-group" id="group-${field.id}" style="margin-bottom:25px;position:relative;z-index:${100 - i};">${inner}</div>`;
    });

    document.getElementById('dynamic-form-container').innerHTML = parts.join('');

    // Wire up field-specific logic
    formFieldsData.forEach((field) => {
        if (field.type === 'address') {
            initAutocomplete(document.getElementById(`input-${field.id}`), document.getElementById(`sug-${field.id}`));
        } else if (field.type === 'entree_select') {
            const selectEl = document.getElementById(`input-${field.id}`);
            const custContainer = document.getElementById(`cust-${field.id}`);
            const renderCust = () => {
                const entreeObj = field.entrees[parseInt(selectEl.value, 10)];
                const customizations = entreeObj?.customizations || [];
                if (customizations.length > 0) {
                    custContainer.innerHTML = `
                        <p style="margin-bottom:10px;font-weight:bold;font-size:0.9rem;color:#94A3B8;">Included by default (uncheck to remove):</p>
                        ${customizations.map(c => `<label style="display:flex;align-items:center;margin-bottom:10px;cursor:pointer;">
                            <input type="checkbox" class="cust-checkbox-${field.id}" data-name="${c.name}" ${c.default ? 'checked' : ''} style="margin-right:10px;width:18px;height:18px;">
                            <span>${c.name}</span>
                        </label>`).join('')}
                    `;
                    custContainer.classList.remove('hidden');
                } else {
                    custContainer.innerHTML = '';
                    custContainer.classList.add('hidden');
                }
            };
            selectEl.addEventListener('change', renderCust);
            renderCust();
        }
    });

    document.querySelectorAll('.addon-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const isPlus = btn.classList.contains('plus');
            const groupId = btn.dataset.group;
            const item = btn.dataset.item;
            const countSpan = document.getElementById(`count-${groupId}-${item.replace(/[^a-zA-Z0-9]/g, '')}`);
            const state = globalAddonState[groupId];
            if (!state.items[item]) state.items[item] = 0;

            if (isPlus) {
                if (state.total < state.max) { state.items[item]++; state.total++; }
                else { showError(state.error_message || 'Maximum limit reached!'); }
            } else {
                if (state.items[item] > 0) { state.items[item]--; state.total--; }
            }
            countSpan.textContent = state.items[item];

            const atMax = state.total >= state.max;
            document.querySelector(`.addon-group-container[data-group-id="${groupId}"]`).querySelectorAll('.addon-btn.plus').forEach(b => {
                b.style.background = atMax ? 'rgba(255,255,255,0.1)' : '#ef4444';
                b.style.color = atMax ? '#94A3B8' : 'white';
                b.style.cursor = atMax ? 'not-allowed' : 'pointer';
            });
        });
    });

    const inputs = Array.from(document.querySelectorAll('.dynamic-input'));
    inputs.forEach((input, index) => {
        input.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); inputs[index + 1]?.focus() ?? input.blur(); }
        });
    });
}

async function checkWinner() {
    try {
        const { data, error } = await supabaseClient
            .from('first_to_click').select('*').eq('giveaway_id', giveawayId)
            .order('created_at', { ascending: true }).limit(1);
        if (error) throw error;

        if (data && data.length > 0) {
            isGameOver = true;
            const winner = data[0];
            clickBtn.disabled = true;
            clickBtn.classList.add('hidden');
            winnerDisplay.classList.remove('hidden');

            if (winner.session_id === sessionId) {
                winnerHeaderEl.textContent = 'YOU WON!';
                document.getElementById('discord-promo')?.classList.add('hidden');
                if (winner.participant_name) {
                    winnerNameEl.textContent = winner.participant_name;
                    winnerNameEl.style.cssText = 'font-size:3rem;color:white;';
                    claimForm.classList.add('hidden');
                    const savedToast = localStorage.getItem(`toast_${giveawayId}`);
                    if (savedToast) showToast(savedToast, 5000);
                } else {
                    winnerNameEl.textContent = '🏆';
                    winnerNameEl.style.fontSize = '3.5rem';
                    setupProgressiveDisclosure();
                    claimForm.classList.remove('hidden');
                }
                if (!window.confettiFired) {
                    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#FF3366', '#7C3AED', '#FBBF24'] });
                    window.confettiFired = true;
                }
            } else {
                winnerHeaderEl.textContent = 'SOMEONE WAS FASTER';
                claimForm.classList.add('hidden');
                document.getElementById('discord-promo')?.classList.remove('hidden');
                const { data: myData } = await supabaseClient
                    .from('first_to_click').select('created_at')
                    .eq('giveaway_id', giveawayId).eq('session_id', sessionId).limit(1);

                if (myData && myData.length > 0) {
                    const diff = (((new Date(myData[0].created_at)) - (new Date(winner.created_at))) / 1000).toFixed(2);
                    winnerNameEl.textContent = `by ${diff}s`;
                    winnerNameEl.style.cssText = 'font-size:2.5rem;color:#94A3B8;text-shadow:none;';
                } else {
                    const timeStr = timeAgo(winner.created_at);
                    winnerNameEl.textContent = timeStr === 'just now' ? 'Claimed just now' : `Claimed ${timeStr} ago`;
                    winnerNameEl.style.cssText = 'font-size:1.8rem;color:#94A3B8;text-shadow:none;';
                }
            }
        } else {
            isGameOver = false;
            clickBtn.disabled = false;
            clickBtn.innerHTML = '<span class="btn-text">CLICK TO CLAIM!</span>';
            clickBtn.classList.remove('hidden');
            winnerDisplay.classList.add('hidden');
            claimForm.classList.add('hidden');
            document.getElementById('discord-promo')?.classList.add('hidden');
            window.confettiFired = false;
        }
    } catch (err) { console.error(err); }
}

clickBtn.addEventListener('click', async () => {
    if (isGameOver) return;

    if (restrictTime && restrictTime !== 'none') {
        const now = new Date();
        const isPast1030 = now.getHours() > 10 || (now.getHours() === 10 && now.getMinutes() >= 30);
        if (restrictTime === 'before' || restrictTime === true) {
            if (isPast1030) { showError(restrictTimeMessage || 'Breakfast is only available before 10:30 AM!'); shake(clickBtn); return; }
        } else if (restrictTime === 'after') {
            if (!isPast1030) { showError(restrictTimeMessage || 'Lunch/Dinner is only available after 10:30 AM!'); shake(clickBtn); return; }
        }
    }

    clickBtn.disabled = true;
    clickBtn.innerHTML = '<span class="btn-text">PROCESSING...</span>';
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/first_to_click?apikey=${SUPABASE_ANON_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ session_id: sessionId, giveaway_id: giveawayId })
        });
        if (!res.ok) throw new Error(await res.text());
        await new Promise(r => setTimeout(r, 400));
        await checkWinner();
    } catch (err) {
        console.error(err);
        showError('Something went wrong. Try again.');
        clickBtn.disabled = false;
        clickBtn.innerHTML = '<span class="btn-text">CLICK TO CLAIM!</span>';
    }
});

function validateField(input, config) {
    const val = input.value.trim();
    const type = input.dataset.type;
    if (type === 'text') {
        if (!val && config.required !== false) { showError(config.error_message || 'Please fill out this field!'); shake(input); return false; }
        if (config.no_spaces_allowed && val.includes(' ')) { showError(config.spaces_error_message || 'Spaces are not allowed!'); shake(input); return false; }
    }
    if (type === 'address' && !val && config.required !== false) {
        showError(config.error_message || 'Please enter a valid store address!'); shake(input); return false;
    }
    return true;
}

submitNameBtn.addEventListener('click', async () => {
    const inputs = document.querySelectorAll('.dynamic-input');
    if (!inputs.length) return;

    for (const input of inputs) {
        if (!validateField(input, formFieldsData[parseInt(input.dataset.index, 10)] || {})) return;
    }

    submitNameBtn.disabled = true;
    submitNameBtn.innerHTML = '<span class="btn-text">SAVING...</span>';

    try {
        const primaryName = inputs[0].value.trim();
        const payload = { participant_name: primaryName };
        const options = {};

        formFieldsData.forEach((field, i) => {
            if (i === 0) return;
            if (field.type === 'text' || field.type === 'address') {
                const inp = document.getElementById(`input-${field.id}`);
                (options.fields ??= {})[field.label] = inp.value.trim();
            } else if (field.type === 'entree_select') {
                const sel = document.getElementById(`input-${field.id}`);
                const entreeObj = field.entrees[parseInt(sel.value, 10)];
                const customizations = {};
                document.querySelectorAll(`.cust-checkbox-${field.id}`).forEach(cb => { customizations[cb.dataset.name] = cb.checked; });
                (options.entrees ??= {})[field.label] = { name: entreeObj.name, customizations };
            } else if (field.type === 'counter_group') {
                const state = globalAddonState[field.id];
                const active = Object.fromEntries(Object.entries(state.items).filter(([, v]) => v > 0));
                if (Object.keys(active).length > 0) (options.addons ??= {})[field.title] = active;
            }
        });

        if (Object.keys(options).length > 0) payload.reward_options = options;

        const res = await fetch(`${SUPABASE_URL}/rest/v1/first_to_click?giveaway_id=eq.${giveawayId}&session_id=eq.${sessionId}&apikey=${SUPABASE_ANON_KEY}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Prefer': 'return=minimal' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(await res.text());

        claimForm.classList.add('hidden');
        winnerNameEl.textContent = primaryName;
        winnerNameEl.style.cssText = 'font-size:3rem;color:white;';

        const successText = customMessage ? (customMessage.startsWith('✅') ? customMessage : '✅ ' + customMessage) : '✅ Submitted!';
        showToast(successText, 5000);
        localStorage.setItem(`toast_${giveawayId}`, successText);
    } catch (err) {
        console.error(err);
        showError('Failed to save username.');
        submitNameBtn.disabled = false;
        submitNameBtn.innerHTML = '<span class="btn-text">SUBMIT</span>';
    }
});

validateAndInit();
