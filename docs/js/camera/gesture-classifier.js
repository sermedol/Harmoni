// harmoni.py HandTracker._build_packet (karar agaci) ve _stable_gesture
// (cogunluk-oyu stabilizasyonu) - birebir port.

// fingers: [thumb, index, middle, ring, pinky] (bool[5])
// pinch: bas parmak-isaret parmagi mesafesi / el boyu
export function classifyGesture(fingers, pinch) {
  const [thumb, index, middle, ring, pinky] = fingers;
  const openCount = fingers.filter(Boolean).length;
  if (pinch < 0.26) return "PINCH";
  if (index && middle && !ring && !pinky) return "PEACE";
  if (index && !middle && !ring && !pinky) return "POINT";
  if (openCount >= 4) return "OPEN_HAND";
  if (openCount <= 1 && !index) return "FIST";
  return "NEUTRAL";
}

// Her el (LEFT/RIGHT) icin son 5 jestin cogunluk oyu ile kararlilastirilmasi;
// >=3/5 ayni jest degilse onceki (fallback) jest korunur (titremeyi onler).
export function createGestureHistory(maxLen = 5) {
  const histories = new Map();
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
      return bestCount >= 3 ? best : gesture;
    },
  };
}
