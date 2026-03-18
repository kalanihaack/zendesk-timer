document.addEventListener('DOMContentLoaded', () => {
    const clearBtn = document.getElementById('clear-all');
    const toggleTimer = document.getElementById('timer-toggle');
    const statusText = document.querySelector('.status');

    chrome.storage.local.get(['USE_SHORT_TIMER'], (result) => {
        if (toggleTimer) {
            toggleTimer.checked = !!result.USE_SHORT_TIMER; 
        }
    });

    if (toggleTimer) {
        toggleTimer.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            
            chrome.storage.local.set({ USE_SHORT_TIMER: isChecked }, () => {
                statusText.innerText = isChecked ? "✅ Timer de 3 Min ativado!" : "✅ Timer de 5 Min ativado!";
                statusText.style.color = "green";
                statusText.style.fontWeight = "bold";
                
                setTimeout(() => {
                    statusText.innerText = "Versão estável (Base v1.0)";
                    statusText.style.color = "#666";
                    statusText.style.fontWeight = "normal";
                }, 2000);
            });
        });
    }


    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            chrome.storage.local.set({ CLEAR_ALL: true }, () => {
                window.close(); 
            });
        });
    }
});