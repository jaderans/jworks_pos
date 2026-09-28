/** Where to go right after setup (read by the home route, which otherwise opens the register). */
let pending: string | null = null;
export const setLanding = (path: string) => {
  pending = path;
};
export const peekLanding = () => pending;
export const clearLanding = () => {
  pending = null;
};
