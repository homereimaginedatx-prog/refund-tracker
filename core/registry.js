/* Feature registry — the seam that lets future building blocks plug in.

   A feature registers itself once:
     registerFeature({ id, label, icon, mount(container) })
   The shell renders a nav entry per feature and calls mount() when it's selected.
   Adding a future block (import, reports, ...) = new folder + one registerFeature call.
   No edits to the shell, no build step. */

const features = [];

export function registerFeature(feature) {
  if (!feature || !feature.id || typeof feature.mount !== 'function') {
    throw new Error('registerFeature requires { id, mount() }');
  }
  if (features.some((f) => f.id === feature.id)) return; // idempotent
  features.push(feature);
}

export function getFeatures() {
  return features.slice();
}
