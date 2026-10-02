// The page's entry: the loading screen and its lobby (lobby.ts: dress the rider) come up at once,
// while the game itself (main.ts, with Rapier and the city) arrives as a chunk of its own and loads
// behind them.

import { openLobby } from './lobby.ts';

const params = new URLSearchParams(location.search);

/** Phones and tablets: the browser says so, no mouse or trackpad at all, or a phone-sized screen. */
function onMobile() {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return nav.userAgentData?.mobile === true || !matchMedia('(any-pointer: fine)').matches || Math.min(screen.width, screen.height) < 500;
}

function start() {
  const lobby = openLobby();
  import('./main.ts')
    .then((game) => game.run(lobby))
    .catch((e) => {
      console.error(e);
      document.getElementById('status')!.textContent = `Failed to start: ${e instanceof Error ? e.message : String(e)}`;
    });
}

// Phones and tablets get the touch controls (index.html #touch); `?touch` shows them anywhere.
const mobile = onMobile();
if (mobile || params.has('touch')) document.documentElement.classList.add('touch');

// The game is made for a desktop: on a phone or tablet say so before loading the whole city
// (the button, or `?desktop`, loads it anyway).
if (mobile && !params.has('desktop')) {
  const loading = document.getElementById('loading')!;
  const dialog = document.getElementById('mobile')!;
  loading.hidden = true;
  dialog.hidden = false;
  document.getElementById('anyway')!.addEventListener('click', () => {
    dialog.hidden = true;
    loading.hidden = false;
    start();
  });
} else {
  start();
}
