/**
 * Rights page of a user, section "Edition per repository and project":
 * the list of the projects of a repository is shown when "Chosen projects"
 * is selected.
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
document.querySelectorAll('#user-edition-rights select.edition-mode').forEach((select) => {
    const projects = select.parentElement.querySelector('.edition-projects');
    if (!projects) {
        return;
    }
    select.addEventListener('change', () => {
        projects.hidden = select.value !== 'projects';
    });
});
