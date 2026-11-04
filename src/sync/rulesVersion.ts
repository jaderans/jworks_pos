/**
 * The version of firebase/firestore.rules this build expects. The app reads
 * ws/<team>/rulesCheck/<RULES_VERSION>; Firebase allows it only when its rules
 * are this version, so an older copy is spotted and the owner is asked to
 * paste the rules again. Change it together with the date in the rules file.
 */
export const RULES_VERSION = '2026-11-04b';
