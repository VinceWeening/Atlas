/** Replace a live list without dropping keyboard focus or the user's scroll position. */
export function vervangMetFocus(vak: HTMLElement, ...inhoud: Node[]) {
  const actief = document.activeElement as HTMLElement | null;
  const pad: number[] = [];
  const sleutel = actief?.dataset.focus;
  const oudLabel = actief?.getAttribute('aria-label');
  const binnen = !!actief && vak.contains(actief);
  if (binnen) {
    for (let el: HTMLElement | null = actief; el && el !== vak; el = el.parentElement) {
      pad.unshift(Array.from(el.parentElement!.children).indexOf(el));
    }
  }
  const scroll = vak.scrollTop;
  vak.replaceChildren(...inhoud);
  vak.scrollTop = scroll;
  if (!binnen || !actief) return;
  const kandidaten = [...vak.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex]')];
  let nieuw = sleutel ? kandidaten.find((el) => el.dataset.focus === sleutel) : undefined;
  if (!nieuw && !sleutel && oudLabel) nieuw = kandidaten.find((el) => el.getAttribute('aria-label') === oudLabel);
  // A vanished entity must never hand keyboard focus to another device by position.
  if (!nieuw && !sleutel) {
    let el: Element | undefined = vak;
    for (const i of pad) el = el?.children[i];
    if (el instanceof HTMLElement && el.tagName === actief.tagName) nieuw = el;
  }
  if (nieuw && !(nieuw instanceof HTMLButtonElement && nieuw.disabled)) nieuw.focus({ preventScroll: true });
}
