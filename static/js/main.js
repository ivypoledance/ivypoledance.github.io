// darkmode
document.getElementById('mode').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});

// enforce local storage setting but also fallback to user-agent preferences
if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.body.classList.add('dark');
}

[...document.getElementsByClassName('imageModal')].forEach(function (element, index, array) {
    element.addEventListener("click", function () {
        // event.preventDefault();
        // return false;
    }, false);
});