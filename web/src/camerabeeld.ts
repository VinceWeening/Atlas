type Camera = { id: string; naam: string };

/** Owns one snapshot: never shows one camera under another camera's name. */
export function maakCamerabeeld(beeld: HTMLImageElement, status: HTMLElement, leeg?: HTMLElement) {
  let camera: Camera | null = null;
  let laatste = 0;
  let actief: HTMLImageElement | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let generatie = 0;
  const tijd = () => new Date(laatste).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function melding(tekst: string, staat: string) {
    status.textContent = tekst;
    status.dataset.status = staat;
    if (leeg) {
      leeg.hidden = laatste > 0;
      leeg.textContent = tekst;
    }
  }
  function stop() {
    generatie++;
    clearTimeout(timeout);
    if (actief) { actief.onload = null; actief.onerror = null; actief.removeAttribute('src'); }
    actief = null;
  }
  function ververs() {
    if (!camera || actief) return;
    const id = camera.id;
    const nu = ++generatie;
    const voorlader = new Image();
    actief = voorlader;
    const klaar = () => {
      clearTimeout(timeout);
      actief = null;
      voorlader.onload = null;
      voorlader.onerror = null;
    };
    const fout = () => {
      if (nu !== generatie) return;
      klaar();
      melding(laatste ? `Verbinding onderbroken · laatste beeld ${tijd()}` : 'Geen beeld · opnieuw proberen…', 'fout');
      voorlader.removeAttribute('src');
    };
    voorlader.onload = () => {
      if (nu !== generatie || camera?.id !== id) return;
      klaar();
      beeld.src = voorlader.src;
      beeld.hidden = false;
      laatste = Date.now();
      melding(`Momentopname · ${tijd()}`, 'klaar');
    };
    voorlader.onerror = fout;
    if (!laatste) melding('Camerabeeld laden…', 'laden');
    timeout = setTimeout(fout, 9000);
    voorlader.src = `/api/camera/${encodeURIComponent(id)}?t=${Date.now()}`;
  }
  function zet(nieuw: Camera | null) {
    if (nieuw?.id === camera?.id) {
      camera = nieuw;
      if (nieuw) beeld.alt = `Momentopname ${nieuw.naam}`;
      return;
    }
    stop();
    camera = nieuw;
    laatste = 0;
    beeld.hidden = true;
    beeld.removeAttribute('src');
    beeld.alt = nieuw ? `Momentopname ${nieuw.naam}` : '';
    if (!nieuw) { melding('Geen camera gevonden', 'leeg'); return; }
    ververs();
  }
  beeld.hidden = true;
  melding('Geen camera gevonden', 'leeg');
  return { zet, ververs, stop };
}
