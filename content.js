let INACTIVITY_LIMIT = (4 * 60 * 1000) + (30 * 1000); // Padrão 4m 30s
const DEBUG_LOG_INTERVAL = 10000; 
const PROCESS_DELAY = 500; 

let chats = {}; 
let processTimeout = null; 

// --- VERIFICAÇÃO INICIAL DO TIMER ---
chrome.storage.local.get(['USE_SHORT_TIMER'], (result) => {
    if (result.USE_SHORT_TIMER) {
        INACTIVITY_LIMIT = 3 * 60 * 1000;
        console.log("%c[Zendesk Debug] Iniciado com Timer de 3 MINUTOS", "color: purple; font-weight: bold;");
    }
});

// --- COMUNICAÇÃO COM O POPUP ---
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.CLEAR_ALL && changes.CLEAR_ALL.newValue === true) {
            chats = {};
            const existingAlert = document.getElementById('zendesk-inactivity-alert');
            if (existingAlert) existingAlert.remove();
            console.log("%c[Zendesk Debug] Todos os monitores zerados via popup.", "color: red; font-weight: bold;");
            chrome.storage.local.set({ CLEAR_ALL: false });
        }
        
        if (changes.USE_SHORT_TIMER) {
            if (changes.USE_SHORT_TIMER.newValue === true) {
                INACTIVITY_LIMIT = 3 * 60 * 1000;
                console.log("%c[Zendesk Debug] Timer alterado para 3 MINUTOS.", "color: purple; font-weight: bold;");
            } else {
                INACTIVITY_LIMIT = (4 * 60 * 1000) + (30 * 1000);
                console.log("%c[Zendesk Debug] Timer retornado para 5 MINUTOS.", "color: purple; font-weight: bold;");
            }
        }
    }
});

// --- INTERFACE ---
function updateAlertUI() {
    const chatsToAlert = Object.keys(chats).filter(id => chats[id].alertShown);

    if (chatsToAlert.length === 0) {
        const existingAlert = document.getElementById('zendesk-inactivity-alert');
        if (existingAlert) existingAlert.remove();
        return;
    }

    let alertDiv = document.getElementById('zendesk-inactivity-alert');
    const alertsHtml = chatsToAlert.map(id => {
        const chat = chats[id];
        return `<div class="alert-item">⚠️ ${chat.ticketProtocol} - ${chat.customerName}</div>`;
    }).join('');
    
    if (!alertDiv) {
        alertDiv = document.createElement('div');
        alertDiv.id = 'zendesk-inactivity-alert';
        document.body.appendChild(alertDiv);
    }

    alertDiv.innerHTML = `
        <div class="alert-header">Enviar sem retorno:</div>
        <div class="alert-list">${alertsHtml}</div>
        <button id="close-alert-all">Dispensar</button>
    `;

    document.getElementById('close-alert-all').onclick = function() {
        chatsToAlert.forEach(id => {
            chats[id].alertShown = false;
            chats[id].isActive = false;
        });
        alertDiv.remove();
    };
}

function getCurrentTicketInfo() {
    const url = window.location.href;
    const ticketMatch = url.match(/\/tickets\/(\d+)/);
    
    let protocolText = "Ticket";
    if (ticketMatch && ticketMatch[1]) {
        protocolText = "#" + ticketMatch[1];
    }

    const activeTab = document.querySelector('[role="tab"][aria-selected="true"][data-test-id="header-tab"]');
    let customerName = "Cliente";
    
    if (activeTab) {
        customerName = activeTab.getAttribute('aria-label') || "Cliente";
    }

    if (customerName === "Cliente") {
        const headerName = document.querySelector('[data-test-id="ticket-pane-header-name"]');
        if (headerName) customerName = headerName.innerText;
    }

    const entityId = activeTab ? activeTab.getAttribute('data-entity-id') : (ticketMatch ? ticketMatch[1] : null);
    return entityId ? { id: entityId, protocol: protocolText, name: customerName } : null;
}

function checkActiveTicketStatus() {
    const info = getCurrentTicketInfo();
    if (!info || !chats[info.id]) return;

    const statusBadges = document.querySelectorAll('.ticket_status_label');
    let shouldStopTimer = false;

    for (let badge of statusBadges) {
        const text = (badge.innerText || badge.textContent || "").trim().toLowerCase();
        
        if (text === "resolvido" || text === "em espera") {
            shouldStopTimer = true;
            break;
        }
    }

    if (shouldStopTimer) {
        console.log(`%c[Zendesk Debug] Ticket ${info.protocol} resolvido/em espera. Timer cancelado.`, "color: #28a745; font-weight: bold;");
        stopWaitingForCustomer(info.id);
    }
}

function startWaitingForCustomer(chatId, protocol, name, currentMsgSignature) {
    if (chats[chatId]) {
        if (chats[chatId].lastMsgSignature !== currentMsgSignature) {
            chats[chatId].startTime = new Date();
            chats[chatId].lastMsgSignature = currentMsgSignature;
            chats[chatId].alertShown = false;
            chats[chatId].isActive = true;
            console.log(`%c[Zendesk Debug] TIMER REINICIADO: ${protocol}`, "color: #006aff; font-weight: bold;");
        }
    } else {
        chats[chatId] = {
            startTime: new Date(),
            ticketProtocol: protocol,
            customerName: name,
            lastMsgSignature: currentMsgSignature,
            alertShown: false,
            isActive: true
        };
        console.log(`%c[Zendesk Debug] MONITOR INICIADO: ${protocol}`, "color: orange; font-weight: bold;");
    }
}

function stopWaitingForCustomer(chatId) {
    if (chats[chatId]) {
        console.log(`%c[Zendesk Debug] Monitoramento removido para: ${chats[chatId].ticketProtocol}`, "color: green; font-weight: bold;");
        delete chats[chatId];
        updateAlertUI();
    }
}

setInterval(() => {
    checkActiveTicketStatus();

    const now = new Date();
    let changed = false;
    for (let id in chats) {
        const chat = chats[id];
        if (!chat.isActive || chat.alertShown) continue;

        const elapsed = now - chat.startTime;
        if (elapsed >= INACTIVITY_LIMIT) {
            chat.alertShown = true;
            changed = true;
        }
    }
    if (changed) updateAlertUI();
}, 1000);

const observer = new MutationObserver((mutations) => {
    const isRelevant = mutations.some(m => 
        (m.target instanceof HTMLElement && m.target.closest('[data-test-id="omni-log-container"]')) || 
        (m.target instanceof HTMLElement && m.target.closest('[data-test-id="omni-log-comment-item"]'))
    );
    
    if (!isRelevant) return;

    if (processTimeout) clearTimeout(processTimeout);
    
    processTimeout = setTimeout(() => {
        const info = getCurrentTicketInfo();
        if (!info) return;

        const messages = document.querySelectorAll('[data-test-id="omni-log-comment-item"]');
        if (messages.length === 0) return;

        const lastMessage = messages[messages.length - 1];
        const isCustomer = lastMessage.querySelector('[type="end-user"]');
        
        const msgContent = lastMessage.innerText.trim();
        const msgAuthor = isCustomer ? "customer" : "agent";
        const msgSignature = `${msgAuthor}_${msgContent.substring(0, 100)}_${messages.length}`;

        if (isCustomer) {
            stopWaitingForCustomer(info.id);
        } else {
            startWaitingForCustomer(info.id, info.protocol, info.name, msgSignature);
        }
    }, PROCESS_DELAY);
});

function init() {
    console.log("%c[Debug] v1.9 (Auto-Stop Status com ticket_status_label) - Iniciada.", "color: white; background: #006aff; padding: 5px;");
    const logContainer = document.querySelector('[data-test-id="omni-log-container"]') || document.body;
    observer.observe(logContainer, { childList: true, subtree: true, characterData: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();