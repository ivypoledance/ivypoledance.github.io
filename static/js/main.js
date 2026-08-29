// darkmode
document.getElementById('mode').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});

// enforce local storage setting but also fallback to user-agent preferences
if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.body.classList.add('dark');
}

function closeModal(element) {
    element.closest('.imageModal').remove();
    return false;
}

// Appended as a node. Rebuilding document.body.innerHTML would discard every
// listener registered above, leaving the dark mode button dead, and would
// reload each embedded iframe on the page.
function openModal(imageLink, event) {
    if (event) {
        event.preventDefault();
    }

    const modal = document.createElement('div');
    modal.className = 'imageModal';

    const close = document.createElement('span');
    close.textContent = '×';
    close.setAttribute('role', 'button');
    close.setAttribute('aria-label', 'Schließen');

    const image = document.createElement('img');
    image.src = imageLink.href;
    image.alt = imageLink.querySelector('img')?.alt ?? '';

    modal.append(close, image);

    const credit = imageLink.dataset.credit;
    if (credit) {
        const caption = document.createElement('p');
        caption.className = 'image-credit';
        caption.textContent = credit;
        modal.append(caption);
    }

    const dismiss = () => {
        document.removeEventListener('keydown', onKeydown);
        modal.remove();
    };
    const onKeydown = (keyEvent) => {
        if (keyEvent.key === 'Escape') {
            dismiss();
        }
    };

    // The cross, the backdrop and Escape all close it.
    modal.addEventListener('click', (clickEvent) => {
        if (clickEvent.target === modal || clickEvent.target === close) {
            dismiss();
        }
    });
    document.addEventListener('keydown', onKeydown);

    document.body.append(modal);
    return false;
}
