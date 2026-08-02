// Olcu (meter) modeli.
//
// Onceki sistemde ritim `stepIndex % 8` idi: sekiz adim, her adim yarim vurus.
// Bu, olcuyu fiilen 4/4'e sabitliyordu. 3/4, 6/8, 7/8, 9/8 secilse bile ayni
// sekiz adim calisiyordu ve Turk usulleri temsil edilemiyordu.
//
// Burada olcu sadece numerator/denominator degil; IC VURGU GRUBU da tasinir.
// 9/8 aksak [2,2,2,3] ile 9/8 [3,3,3] ayni sayida sekizlik icerir ama bambaska
// muziklerdir. Grouping olmadan aksak temsil edilemez.

/**
 * @param {object} options
 * @param {number} options.numerator      olcudeki birim sayisi (9/8'de 9)
 * @param {number} options.denominator    birim nota degeri (9/8'de 8)
 * @param {number[]} options.beatGroups   ic gruplama, toplami numerator olmali
 * @param {number} [options.ticksPerUnit] birim basina cozunurluk (alt bolum)
 * @param {number} [options.bpmUnit]      BPM'in saydigi nota degeri
 * @param {string} [options.id]
 * @param {string} [options.displayName]
 */
export function createMeter({
  numerator,
  denominator,
  beatGroups,
  ticksPerUnit = 4,
  bpmUnit = denominator,
  id = `${numerator}/${denominator}`,
  displayName = `${numerator}/${denominator}`,
}) {
  if (!Array.isArray(beatGroups) || !beatGroups.length) {
    throw new Error(`${id}: beatGroups zorunlu`);
  }
  const total = beatGroups.reduce((a, b) => a + b, 0);
  if (total !== numerator) {
    // Sessizce kabul edilirse aksak olculer yanlis uzunlukta calar.
    throw new Error(`${id}: beatGroups toplami ${total}, numerator ${numerator} olmali`);
  }

  const ticksPerBar = numerator * ticksPerUnit;

  // Her grubun basladigi tick. Aksakta gruplar esit degildir.
  const groupStarts = [];
  let unit = 0;
  for (const group of beatGroups) {
    groupStarts.push(unit * ticksPerUnit);
    unit += group;
  }

  return {
    id,
    displayName,
    numerator,
    denominator,
    beatGroups: [...beatGroups],
    ticksPerUnit,
    ticksPerBar,
    bpmUnit,
    groupStarts,

    /** Bir tick'in saniye cinsinden suresi. */
    secondsPerTick(bpm) {
      const safeBpm = Math.max(1, bpm);
      // BPM bpmUnit-notasi sayar; bir bpmUnit-notasi 60/bpm saniyedir.
      // Bir denominator-notasi = (60/bpm) * (bpmUnit / denominator).
      return (60 / safeBpm) * (bpmUnit / denominator) / ticksPerUnit;
    },

    secondsPerBar(bpm) {
      return this.secondsPerTick(bpm) * ticksPerBar;
    },

    /** Tick bir grup (vurus) basi mi? */
    isBeatStart(tick) {
      return groupStarts.includes(((tick % ticksPerBar) + ticksPerBar) % ticksPerBar);
    },

    isDownbeat(tick) {
      return (((tick % ticksPerBar) + ticksPerBar) % ticksPerBar) === 0;
    },

    /** Tick'in ait oldugu grup indeksi. */
    groupIndexAt(tick) {
      const position = ((tick % ticksPerBar) + ticksPerBar) % ticksPerBar;
      let index = 0;
      for (let i = 0; i < groupStarts.length; i++) {
        if (position >= groupStarts[i]) index = i;
      }
      return index;
    },

    /**
     * Vurgu agirligi 0-1. Olcu basi en guclu, grup baslari orta,
     * ara alt bolumler zayif. Aksakta uzun grup (3) kisa gruptan (2)
     * biraz daha vurgulu okunur.
     */
    accentAt(tick) {
      const position = ((tick % ticksPerBar) + ticksPerBar) % ticksPerBar;
      if (position === 0) return 1;
      const index = groupStarts.indexOf(position);
      if (index >= 0) {
        const group = beatGroups[index];
        const longest = Math.max(...beatGroups);
        return group === longest && longest > Math.min(...beatGroups) ? 0.75 : 0.62;
      }
      // Grup ici: birim basi mi yoksa daha ince alt bolum mu?
      return position % ticksPerUnit === 0 ? 0.42 : 0.24;
    },
  };
}

// --- Hazir olculer -------------------------------------------------------
// status: "verified"     yaygin ve tartismasiz gruplama
// status: "experimental" gruplama kaynakla dogrulanmadi

export const METERS = {
  "4/4": createMeter({
    numerator: 4, denominator: 4, beatGroups: [1, 1, 1, 1],
    ticksPerUnit: 4, bpmUnit: 4, displayName: "4/4",
  }),
  "3/4": createMeter({
    numerator: 3, denominator: 4, beatGroups: [1, 1, 1],
    ticksPerUnit: 4, bpmUnit: 4, displayName: "3/4",
  }),
  "6/8": createMeter({
    // Bilesik ikili: iki noktali-dortluk vurus. BPM noktali dortluk sayar.
    numerator: 6, denominator: 8, beatGroups: [3, 3],
    ticksPerUnit: 2, bpmUnit: 8, displayName: "6/8",
  }),
  "9/8-aksak": createMeter({
    // Turk muziginde yaygin aksak dokuzlu: 2+2+2+3.
    numerator: 9, denominator: 8, beatGroups: [2, 2, 2, 3],
    ticksPerUnit: 2, bpmUnit: 8, id: "9/8-aksak", displayName: "9/8 aksak (2+2+2+3)",
  }),
  "7/8-aksak": createMeter({
    numerator: 7, denominator: 8, beatGroups: [2, 2, 3],
    ticksPerUnit: 2, bpmUnit: 8, id: "7/8-aksak", displayName: "7/8 aksak (2+2+3)",
  }),
  "5/8-aksak": createMeter({
    numerator: 5, denominator: 8, beatGroups: [2, 3],
    ticksPerUnit: 2, bpmUnit: 8, id: "5/8-aksak", displayName: "5/8 aksak (2+3)",
  }),
};

export function getMeter(id) {
  return METERS[id] || METERS["4/4"];
}
