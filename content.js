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
const PROCESS_DELAY = 500; // Delay de 0.5 segundos para a pagina carregar

// Variaveis Globais
let chats = {}; // armazena os chats a serem monitoriados
let processTimeout = null; // contador, iniciado em null

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
        console.log("[Zendesk Debug] Alertas limpos pelo usuário.");
    };
}

// --- CORE ---

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




// Esta função verifica se a última mensagem enviada pelo analista é diferente da penúltima.
// Caso seja diferente, o contador é resetado. Caso seja igual, o contador continua incrementando.
// Essa verificação booleana evita um bug onde o contador poderia reiniciar indevidamente.
function startWaitingForCustomer(chatId, protocol, name, currentMsgSignature) {
    if (chats[chatId]) {
        // SÓ REINICIA se a assinatura da mensagem for REALMENTE diferente
        if (chats[chatId].lastMsgSignature !== currentMsgSignature) {
            chats[chatId].startTime = new Date();
            chats[chatId].lastMsgSignature = currentMsgSignature;
            chats[chatId].alertShown = false;
            chats[chatId].isActive = true;
            console.log(`%c[Zendesk Debug] TIMER REINICIADO (v1.8): ${protocol} (${name}) - Nova mensagem real detectada.`, "color: #006aff; font-weight: bold;");
        } else {
            // Se a assinatura for igual, não faz nada (evita o loop de reset)
            
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
        console.log(`%c[Zendesk Debug] MONITOR INICIADO (v1.0): ${protocol} (${name})`, "color: orange; font-weight: bold;");
    }
}

// Para de observar o chat, e reseta o contador
function stopWaitingForCustomer(chatId) {
    if (chats[chatId]) {
        console.log(`%c[ Debug] CLIENTE RESPONDEU: ${chats[chatId].ticketProtocol}. Monitor removido.`, "color: green; font-weight: bold;");
        delete chats[chatId];
        updateAlertUI();
    }
}

// Loop de Verificação (1s)
setInterval(() => {
    const now = new Date();
    let changed = false;
    for (let id in chats) {
        const chat = chats[id];
        if (!chat.isActive || chat.alertShown) continue;

        const elapsed = now - chat.startTime;
        if (elapsed >= getInactivityLimit()) {
            chat.alertShown = true;
            changed = true;
            console.log(`%c[Zendesk ALERTA] ${chat.ticketProtocol} (${chat.customerName}) atingiu 4 min!`, "color: red; font-weight: bold;");
        }
    }
    if (changed) updateAlertUI();
}, 1000);

// Log de Status Periódico (a cada 10s) para monitoramento no console
setInterval(() => {
    const activeChats = Object.values(chats).filter(c => c.isActive && !c.alertShown);
    if (activeChats.length > 0) {
        console.log(`--- [Zendesk Status v1.0 - ${new Date().toLocaleTimeString()}] ---`);
        activeChats.forEach(c => {
            const secLeft = Math.round((getInactivityLimit() - (new Date() - c.startTime)) / 1000);
            console.log(`- ${c.ticketProtocol} (${c.customerName}): ${secLeft}s restantes.`);
        });
    }
}, DEBUG_LOG_INTERVAL);

// --- OBSERVAÇÃO DE MENSAGENS ---

const observer = new MutationObserver((mutations) => {
    // Filtro rápido: só processa se a mudança for relevante no DOM
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
        
        // ASSINATURA DIGITAL: Combina conteúdo, autor e quantidade de mensagens
        // Isso garante que só mude se a mensagem for REALMENTE nova
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
    console.log("%c[Debug] v1.8 (Anti-Loop) - Iniciada.", "color: white; background: #006aff; padding: 5px;");
    // Observa o container de logs especificamente se possível, senão o body com filtro
    const logContainer = document.querySelector('[data-test-id="omni-log-container"]') || document.body;
    observer.observe(logContainer, { childList: true, subtree: true, characterData: true });
}



// Não consegui fazer isso funcionar
chrome.storage.local.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.CLEAR_ALL && changes.CLEAR_ALL.newValue === true) {
        chats = {};
        updateAlertUI();
        console.log("%c[ Debug] Todos os monitores zerados via popup.", "color: red; font-weight: bold;");
        // Resetar a flag no storage para que o comando não seja reexecutado
        chrome.storage.local.set({ CLEAR_ALL: false });
    }
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
