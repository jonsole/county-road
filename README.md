# County Road

A 3D free-roam driving sandbox for desktop browsers. Explore two connected country-road loops, cross the fields, or test the rear-wheel-drive sports car on the skidpad.

[Play County Road on GitHub Pages](https://jonsole.github.io/county-road/).

## Run locally

With Node.js 22.12 or newer, run:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite in a WebGL 2 browser. Connect a standard Xbox- or PlayStation-style controller and press a button while the game tab is focused.

| Action | Gamepad | Keyboard |
| --- | --- | --- |
| Steer | Left stick | A / D or left / right |
| Throttle | Right trigger | W or up |
| Brake | Left trigger | S or down |
| Look around | Right stick | |
| Toggle drive or reverse while stopped | A / Cross | F |
| Recover to the nearest road | Y / Triangle | R |
| Headlights on or off | X / Square | L |

The headlights come on by themselves at dusk, at night, and in mist or low cloud. Switching them by hand overrides that until you reload.

Open **Settings** or press **Esc** to change keyboard bindings and configure connected controllers or wheels. Pick a device, then select an axis or button directly or click **Detect** and move the control. Use the calibration buttons at each named position to set the range for a steering wheel, stick, or pedal. The reading shows the raw input followed by the calibrated input. Bindings are saved in this browser by device. Wheels and pedals need to be exposed by the browser as game controllers.

The sky, weather and countryside come from [RC Flight Sim](https://github.com/jonsole/rc-flight-sim): a daylight sky with the sun placed for the time and date at an English latitude, twilight and a starry night, drifting clouds whose shadows cross the ground, mist and low cloud, and rolling hills of farm fields, hedgerows and copses that fade into the horizon haze. The drivable area stays flat. The **Sky & weather** tab in **Settings** sets:

| Option | Choices |
| --- | --- |
| Time of day, time of year | Any; or **Use my clock** to follow your computer's time and date. The date moves the sun's path and turns the grass and trees through the seasons. |
| Sun glare | Looking into a low sun washes the picture out; hills and cloud block it. |
| Cloud cover and type | Clear to overcast; fair-weather cumulus, stratocumulus rolls, altocumulus (mackerel sky), or high cirrus. |
| Low cloud | Seasonal (some spring and autumn days), off, broken, or overcast. |
| Mist and fog | Seasonal (spring and autumn mornings), off, light mist, or thick fog. |
| Wind | Speed and direction; the clouds and mist drift with it. |
| Moon | Its real phase for the date, or new, crescent, half, gibbous, or full. It rises and sets with its phase and lights the night by how full it is. |
| Stars | Dark countryside, town glow (fewer), or off. |

The code is in `sky.js`, `weather.js`, `landscape.js`, `glare.js`, and `skySettings.js`.

Each tire samples its own contact surface. Asphalt has sharper turn-in and stronger traction. Grass builds cornering force more slowly, adds rolling drag, and loses more grip at speed and when sliding.

Surface textures (asphalt, grass, mud, gravel, paving) are CC0 photographs from [Poly Haven](https://polyhaven.com); see `public/textures/CREDITS.txt`. The sun and moon cast real shadows around the car.

Run `npm test` for simulation and input checks, and `npm run build` for the static build.

GitHub Actions tests and builds the game on pushes to `main`, then publishes it to GitHub Pages.
