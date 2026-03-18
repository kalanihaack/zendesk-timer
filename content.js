let isShortTimerActive = false; 
const PROCESS_DELAY = 500; 

let chats = {}; 
let processTimeout = null; 

chrome.storage.local.get(['USE_SHORT_TIMER'], (result) => {
    isShortTimerActive = !!result.USE_SHORT_TIMER;
    console.log(`%c[Zendesk Debug] Iniciado. Timer Curto (3+2) Ativado: ${isShortTimerActive}`, "color: purple; font-weight: bold;");
});

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
            isShortTimerActive = changes.USE_SHORT_TIMER.newValue === true;
            console.log(`%c[Zendesk Debug] Toggle alterado. Timer Curto Ativado: ${isShortTimerActive}`, "color: purple; font-weight: bold;");
        }
    }
});

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
        const isStage1 = chat.stage === 1;
        
        let stageText = "";
        if (isShortTimerActive) {
            stageText = isStage1 ? "1º Alerta (3 min)" : "2º Alerta (2 min)";
        } else {
            stageText = isStage1 ? "1º Alerta (5 min)" : "2º Alerta (5 min)";
        }
        
        const emoji = isStage1 ? "⚠️" : "🚨";
        
        return `
            <div class="alert-item" style="margin-bottom: 5px;">
                ${emoji} ${chat.ticketProtocol} - ${chat.customerName} <br>
                <small style="color: #ffcccc; margin-left: 18px;">${stageText}</small>
            </div>
        `;
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
            chats[chatId].stage = (chats[chatId].stage || 1) + 1; // Avança estágio
            chats[chatId].startTime = new Date();
            chats[chatId].lastMsgSignature = currentMsgSignature;
            chats[chatId].alertShown = false;
            chats[chatId].isActive = true;
            console.log(`%c[Zendesk Debug] TIMER REINICIADO (Estágio ${chats[chatId].stage}): ${protocol}`, "color: #006aff; font-weight: bold;");
        }
    } else {
        chats[chatId] = {
            startTime: new Date(),
            ticketProtocol: protocol,
            customerName: name,
            lastMsgSignature: currentMsgSignature,
            alertShown: false,
            isActive: true,
            stage: 1
        };
        console.log(`%c[Zendesk Debug] MONITOR INICIADO (Estágio 1): ${protocol}`, "color: orange; font-weight: bold;");
    }
}

function stopWaitingForCustomer(chatId) {
    if (chats[chatId]) {
        console.log(`%c[Zendesk Debug] Cliente respondeu / Status alterado: ${chats[chatId].ticketProtocol}. Monitor removido.`, "color: green; font-weight: bold;");
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
        
        // LÓGICA DE TEMPO: Toggle ATIVADO (3+2) ou Toggle DESATIVADO (5+5)
        let limit;
        if (isShortTimerActive) {
            limit = chat.stage === 1 ? (3 * 60 * 1000) : (2 * 60 * 1000); 
        } else {
            limit = 5 * 60 * 1000; 
        }

        if (elapsed >= limit) {
            chat.alertShown = true;
            changed = true;
        }
    }
    if (changed) updateAlertUI();
}, 1000);

setInterval(() => {
    const activeChats = Object.values(chats).filter(c => c.isActive && !c.alertShown);
    if (activeChats.length > 0) {
        console.log(`--- [Zendesk Status v2.1 - ${new Date().toLocaleTimeString()}] ---`);
        activeChats.forEach(c => {
            
            let limit;
            if (isShortTimerActive) {
                limit = c.stage === 1 ? (3 * 60 * 1000) : (2 * 60 * 1000); 
            } else {
                limit = 5 * 60 * 1000; 
            }

            const secLeft = Math.round((limit - (new Date() - c.startTime)) / 1000);
            console.log(`- ${c.ticketProtocol} (${c.customerName}) [Estágio ${c.stage}]: ${secLeft}s restantes.`);
        });
    }
}, DEBUG_LOG_INTERVAL);

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
    console.log("%c[Debug] v2.1 (Toggle + Estágios Inteligentes + Logs) - Iniciada.", "color: white; background: #006aff; padding: 5px;");
    const logContainer = document.querySelector('[data-test-id="omni-log-container"]') || document.body;
    observer.observe(logContainer, { childList: true, subtree: true, characterData: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();