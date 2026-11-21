// Garde l'écran allumé (téléphone posé sur le pupitre).
// Le verrou est relâché par le navigateur quand l'onglet passe en arrière-plan :
// on le redemande au retour.
let lock: WakeLockSentinel | null = null;

async function acquire() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    lock = await navigator.wakeLock.request('screen');
  } catch {
    lock = null; // refusé (batterie faible…) : pas bloquant
  }
}

export function keepScreenOn(): () => void {
  acquire();
  const onVis = () => {
    if (document.visibilityState === 'visible') acquire();
  };
  document.addEventListener('visibilitychange', onVis);
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    lock?.release();
    lock = null;
  };
}
