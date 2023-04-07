// darkmode
document.getElementById('mode').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});

// enforce local storage setting but also fallback to user-agent preferences
if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.body.classList.add('dark');
}

function closeModal(modal) {
    modal.parentElement.remove();
    return false;
}

function openModal(imageLink) {
    document.body.innerHTML = document.body.innerHTML + "" +
        '<div class="imageModal">' +
        '   <span onclick="closeModal(this)">&times;</span>' +
        '   <img src="' + imageLink.href + '" />' +
        '</div>'
    event.preventDefault();
    return false;
}

