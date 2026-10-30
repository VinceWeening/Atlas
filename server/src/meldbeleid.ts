import { nuIn, type Instellingen } from './instellingen.js';

/** Alle meldkanalen volgen dezelfde stilte; gebeurtenissen blijven beschikbaar in de tijdlijn. */
export function meldingKanalen(inst: Instellingen, weg: boolean | null, test = false, nu = new Date()) {
  const stil = !test && (nuIn(inst.meldingen.stil, nu) || inst.meldingen.pauzeTot > nu.getTime());
  const thuis = !test && inst.weg.aan && inst.weg.alleenWeg && weg === false;
  return {
    stil,
    pc: inst.meldingen.pc && !stil,
    popup: inst.meldingen.popup && !stil,
    telefoon: inst.meldingen.telefoon && !!inst.meldingen.toestel && !stil && !thuis,
  };
}
