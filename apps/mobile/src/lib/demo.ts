/**
 * Demo affordances: the "simulate scan" button (there are no physical QR
 * stickers) and the ride screen's "step into zone" control (the simulator
 * moves the scooter; nobody is walking).
 *
 * `__DEV__` is false in a TestFlight/release build, which would strip both
 * and make rides untestable — so a build-time env flag keeps them on for
 * test distributions. Leave the flag unset for a real store build.
 */
export const DEMO_CONTROLS_ENABLED: boolean =
  __DEV__ || process.env.EXPO_PUBLIC_DEMO_CONTROLS === '1';
