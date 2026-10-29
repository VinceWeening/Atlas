// Afwerking: licht dat je muis volgt over het glas, en een sfeer die met het dagdeel en de lampen meekleurt.

/** Glans op het glaspaneel onder de muis: de rand licht op waar je wijst. Alleen met een muis, niet op een touchscreen. */
export function startGlans() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let paneel: HTMLElement | null = null;
  let x = 0;
  let y = 0;
  let wacht = false;
  const zet = () => {
    wacht = false;
    if (!paneel) return;
    const r = paneel.getBoundingClientRect();
    paneel.style.setProperty('--mx', `${x - r.left}px`);
    paneel.style.setProperty('--my', `${y - r.top}px`);
  };
  document.addEventListener(
    'pointermove',
    (e) => {
      const nieuw = (e.target as HTMLElement).closest?.<HTMLElement>('.gl') ?? null;
      if (nieuw !== paneel) {
        paneel?.classList.remove('glans');
        nieuw?.classList.add('glans');
        paneel = nieuw;
      }
      x = e.clientX;
      y = e.clientY;
      if (!wacht) {
        wacht = true;
        requestAnimationFrame(zet);
      }
    },
    { passive: true },
  );
  document.addEventListener('pointerleave', () => {
    paneel?.classList.remove('glans');
    paneel = null;
  });
}

/** Ochtend, middag, avond of nacht op de app, zodat de achtergrond een fractie meekleurt met de tijd. */
export function zetDagdeel() {
  const uur = new Date().getHours();
  const deel = uur < 6 ? 'nacht' : uur < 12 ? 'ochtend' : uur < 18 ? 'middag' : uur < 23 ? 'avond' : 'nacht';
  document.querySelector('.app')?.setAttribute('data-dagdeel', deel);
  return deel;
}

export const begroeting = () =>
  ({ nacht: 'Goedenacht', ochtend: 'Goedemorgen', middag: 'Goedemiddag', avond: 'Goedenavond' })[zetDagdeel()];
