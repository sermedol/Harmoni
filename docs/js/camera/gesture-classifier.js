// harmoni.py HandTracker._build_packet (karar agaci) ve _stable_gesture
// (cogunluk-oyu stabilizasyonu) - birebir port.

// fingers: [thumb, index, middle, ring, pinky] (bool[5])
// pinch: bas parmak-isaret parmagi mesafesi / el boyu
export function classifyGesture(fingers, pinch) {
  const [thumb, index, middle, ring, pinky] = fingers;
  const openCount = fingers.filter(Boolean).length;
  // Yumruk PINCH'ten once bakilir: yumrukta bas parmak ve isaret ucu da
  // birbirine yaklastigi icin pinch esigi yanlislikla tetikleniyordu.
  if (openCount === 0) return "FIST";
  // Gercek pinch'te diger parmaklardan en az biri disarida durur.
  if (pinch < 0.29 && (middle || ring || pinky)) return "PINCH";
  if (index && middle && !ring && !pinky) return "PEACE";
  if (index && !middle && !ring && !pinky) return "POINT";
  if (openCount >= 4) return "OPEN_HAND";
  if (openCount <= 1 && !index) return "FIST";
  return "NEUTRAL";
}

// Her el (LEFT/RIGHT) icin son karelerin cogunluk oyu ile kararlilastirilmasi.
// Pencere kasitli olarak kisa: 5 karenin 3'unu beklemek 30fps'te ~165ms
// gecikme demekti ve jest "gec algilaniyor" hissi veriyordu. 3 karenin 2'si
// titremeyi hala emiyor ama gecikmeyi yariya indiriyor. Ust uste iki ayni
// kare geldiginde jest aninda kabul edilir.
export function createGestureHistory(maxLen = 3, needed = 2) {
  const histories = new Map();
  const stable = new Map();
  return {
    stabilize(label, gesture) {
      let history = histories.get(label);
      if (!history) {
        history = [];
        histories.set(label, history);
      }
      history.push(gesture);
      if (history.length > maxLen) history.shift();
      const counts = new Map();
      for (const item of history) counts.set(item, (counts.get(item) || 0) + 1);
      let best = gesture;
      let bestCount = 0;
      for (const [item, count] of counts) {
        if (count > bestCount) {
          best = item;
          bestCount = count;
        }
      }
      if (bestCount >= needed) stable.set(label, best);
      return stable.get(label) || gesture;
    },
    reset(label) {
      if (label) { histories.delete(label); stable.delete(label); }
      else { histories.clear(); stable.clear(); }
    },
  };
}
