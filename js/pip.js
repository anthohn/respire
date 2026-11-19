// Fenêtre flottante (Picture-in-Picture « document ») : la session reste visible
// au-dessus des autres fenêtres, comme une vidéo YouTube. Disponible sur ordinateur,
// dans les navigateurs Chrome et Edge (Firefox et Safari ne la proposent pas encore).

/** Ordinateur avec souris : on peut continuer en arrière-plan et ouvrir une fenêtre flottante. */
export const isDesktop = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

export const pipSupported = () => isDesktop() && 'documentPictureInPicture' in window;

const PIP_SIZE = { width: 340, height: 470 };

/**
 * Ouvre la fenêtre flottante et y copie les styles de l'application.
 * À appeler directement depuis un clic (le navigateur l'exige).
 */
export async function openPipWindow() {
  const pw = await window.documentPictureInPicture.requestWindow(PIP_SIZE);
  const doc = pw.document;

  doc.documentElement.lang = 'fr';
  doc.documentElement.style.background = '#070b18';
  doc.documentElement.dataset.theme = document.documentElement.dataset.theme || 'auto';
  doc.documentElement.dataset.tod = document.documentElement.dataset.tod || 'day';
  doc.title = 'Respire';
  doc.body.className = 'pip-body';

  const loads = [...document.querySelectorAll('link[rel="stylesheet"]')].map((src) => new Promise((resolve) => {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = src.href;
    link.onload = resolve;
    link.onerror = resolve;
    doc.head.append(link);
  }));
  // On attend les styles (1,5 s au plus) pour éviter un flash de page sans mise en forme.
  await Promise.race([Promise.all(loads), new Promise((resolve) => setTimeout(resolve, 1500))]);
  return pw;
}
