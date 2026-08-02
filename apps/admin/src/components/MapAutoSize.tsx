import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

/**
 * Keeps a Leaflet map sized to its container, and frames a set of points when
 * given some.
 *
 * Leaflet measures its container once, on mount. Every map in this panel is
 * inside something that is not at its final size at that moment — a drawer
 * mid-slide, a card in a grid that has not settled, a collapsed sider. The
 * symptom is always the same and always looks like a data problem rather than
 * a layout one: tiles paint into a strip or a corner, and overlays do not
 * appear at all. Observing the container and re-invalidating fixes it once for
 * every map rather than per screen.
 *
 * A fixed centre and zoom also cannot frame a route or a selection, since
 * those range from a few hundred metres to right across the city.
 */
export function MapAutoSize({
  positions = [],
  padding = 24,
  maxZoom = 16,
}: {
  positions?: [number, number][];
  padding?: number;
  maxZoom?: number;
}): null {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    let lastWidth = 0;
    let lastHeight = 0;

    const apply = (): void => {
      const { clientWidth, clientHeight } = container;
      const resized = clientWidth !== lastWidth || clientHeight !== lastHeight;

      if (resized) {
        lastWidth = clientWidth;
        lastHeight = clientHeight;

        // Neither `invalidateSize` mode is right on its own. The default pans
        // to preserve the centre, and because the observer fires again for
        // each size change that offset accumulates on the map pane until
        // tiles sit hundreds of pixels from where they belong. `pan: false`
        // avoids that but anchors the top-left, so a container that grows
        // rightwards leaves the subject pinned to the left edge.
        //
        // So: keep the centre by hand, then re-set the view. `setView` also
        // forces a clean reset, which is what actually fetches tiles for the
        // newly exposed area.
        const centre = map.getCenter();
        const zoom = map.getZoom();
        map.invalidateSize({ animate: false, pan: false });
        map.setView(centre, zoom, { animate: false });
      }

      if ((resized || positions.length > 0) && positions.length > 0) {
        map.fitBounds(positions, { padding: [padding, padding], maxZoom });
      }
    };

    const observer = new ResizeObserver(apply);
    observer.observe(container);
    const frame = requestAnimationFrame(apply);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [map, positions, padding, maxZoom]);

  return null;
}
