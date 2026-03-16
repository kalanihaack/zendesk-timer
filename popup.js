document.getElementById('clear-all').addEventListener('click', () => {
    chrome.storage.local.set({ CLEAR_ALL: true }, () => {
        console.log("Comando de reset enviado para storage.");
        window.close();
    });
});
