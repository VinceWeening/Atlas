// Voorbeeldgegevens voor fase 1. In fase 2 komen deze uit Home Assistant, Google Agenda en Gmail.
export const voorbeeld = {
  voorbeeld: true,
  weer: { omschrijving: 'Helder', temperatuur: 13, vanavond: 8 },
  agenda: [
    { tijd: '17:30', titel: 'Sporten', detail: 'tot 18:30' },
    { tijd: '19:00', titel: 'Eten bij ouders', detail: 'vertrek 18:40' },
  ],
  morgen: '09:00 · Overleg',
  mail: [
    { van: 'Bol.com', onderwerp: 'Pakket komt morgen' },
    { van: 'Gemeente', onderwerp: 'Afvalkalender 2027' },
    { van: 'Jellyfin', onderwerp: 'Nieuwe film' },
  ],
  voordeur: { laatsteBeweging: '14:12' },
};
