document.addEventListener('DOMContentLoaded', () => {
    const clearBtn = document.getElementById('clear-all');
    const toggleTimer = document.getElementById('timer-toggle');
    const statusText = document.querySelector('.status');

    // 1. Carrega o estado atual salvo na memória assim que abre o popup
    chrome.storage.local.get(['USE_SHORT_TIMER'], (result) => {
        if (toggleTimer) {
            toggleTimer.checked = !!result.USE_SHORT_TIMER; 
        }
    });

    // 2. Salva a preferência sempre que você clicar na caixinha
    if (toggleTimer) {
        toggleTimer.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            
            chrome.storage.local.set({ USE_SHORT_TIMER: isChecked }, () => {
                // Dá um aviso visual rápido de que salvou
                statusText.innerText = isChecked ? "✅ Timer de 3 Min ativado!" : "✅ Timer de 5 Min ativado!";
                statusText.style.color = "green";
                statusText.style.fontWeight = "bold";
                
                // Volta o texto ao normal depois de 2 segundos
                setTimeout(() => {
                    statusText.innerText = "Versão estável (Base v1.0)";
                    statusText.style.color = "#666";
                    statusText.style.fontWeight = "normal";
                }, 2000);
            });
        });
    }

    // 3. Botão de Zerar Monitores
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            chrome.storage.local.set({ CLEAR_ALL: true }, () => {
                window.close(); // Fecha o popup ao clicar
            });
        });
    }
});