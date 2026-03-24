function getInactivityLimit() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();

    const currentTime = hours * 60 + minutes;

    const isPeakTime =
        (currentTime >= (10 * 60) && currentTime <= (14 * 60)) ||
        (currentTime >= (18 * 60) && currentTime <= (22 * 60));

    if (isPeakTime) {
        return 2 * 60 * 1000; // 2 minutos
    }

    return (4 * 60 * 1000) + (30 * 1000); // 4m30s
}
const DEBUG_LOG_INTERVAL = 10000; 
const PROCESS_DELAY = 500; 

let chats = {}; 
let processTimeout = null; 

function isRushHour() {
    const now = new Date();
    const hour = now.getHours(); 
    
    const isMorningRush = hour >= 10 && hour < 14;
    const isEveningRush = hour >= 18 && hour < 22;
    
    return isMorningRush || isEveningRush;
}

function shouldUseShortTimer() {
    return isShortTimerActive || isRushHour();
}

chrome.storage.local.get(['USE_SHORT_TIMER'], (result) => {
    isShortTimerActive = !!result.USE_SHORT_TIMER;
    console.log(`%c[Zendesk Debug] Iniciado. Toggle Manual: ${isShortTimerActive} | Horário de Pico: ${isRushHour()}`, "color: purple; font-weight: bold;");
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
            console.log(`%c[Zendesk Debug] Toggle alterado. Manual Ativado: ${isShortTimerActive}`, "color: purple; font-weight: bold;");
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
        const useShort = shouldUseShortTimer();
        
        let stageText = "";
        if (useShort) {
            const autoText = (isRushHour() && !isShortTimerActive) ? " - Automático" : "";
            stageText = isStage1 ? `1º Alerta (3 min${autoText})` : `2º Alerta (2 min${autoText})`;
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
    if (ticketMatch && ticketMatch[1]) protocolText = "#" + ticketMatch[1];

    const activeTab = document.querySelector('[role="tab"][aria-selected="true"][data-test-id="header-tab"]');
    let customerName = "Cliente";
    
    if (activeTab) customerName = activeTab.getAttribute('aria-label') || "Cliente";

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

function removeClosedChats() {
    for (let id in chats) {
        const tabExists = document.querySelector(`[role="tab"][data-entity-id="${id}"]`);
        
        if (!tabExists) {
            console.log(`%c[Zendesk Debug] Aba do ticket ${chats[id].ticketProtocol} fechada. Limpando timer da memória.`, "color: #ff9800; font-weight: bold;");
            delete chats[id];
            updateAlertUI(); 
        }
    }
}

function startWaitingForCustomer(chatId, protocol, name, currentMsgSignature) {
    if (chats[chatId]) {
        if (chats[chatId].lastMsgSignature !== currentMsgSignature) {
            
            if (chats[chatId].alertShown === true || chats[chatId].isActive === false) {
                chats[chatId].stage = chats[chatId].stage === 1 ? 2 : 1;
            }
            
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
    removeClosedChats();
    checkActiveTicketStatus();

    const now = new Date();
    let changed = false;
    
    for (let id in chats) {
        const chat = chats[id];
        if (!chat.isActive || chat.alertShown) continue;

        const elapsed = now - chat.startTime;
        if (elapsed >= getInactivityLimit()) {
            chat.alertShown = true;
            changed = true;
        }
    }
    if (changed) updateAlertUI();
}, 1000);

setInterval(() => {
    const activeChats = Object.values(chats).filter(c => c.isActive && !c.alertShown);
    if (activeChats.length > 0) {
        console.log(`--- [Zendesk Status v2.4 - ${new Date().toLocaleTimeString()}] ---`);
        activeChats.forEach(c => {
            const secLeft = Math.round((getInactivityLimit() - (new Date() - c.startTime)) / 1000);
            console.log(`- ${c.ticketProtocol} (${c.customerName}): ${secLeft}s restantes.`);
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
    console.log("%c[Debug] v2.4 (Limpeza de Abas Fechadas) - Iniciada.", "color: white; background: #006aff; padding: 5px;");
    const logContainer = document.querySelector('[data-test-id="omni-log-container"]') || document.body;
    observer.observe(logContainer, { childList: true, subtree: true, characterData: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();