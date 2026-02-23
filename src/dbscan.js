export function dbscan(points, eps, minPts) {
  let clusterId = 0;
  const visited = new Set();

  function distance(a, b) {
    const dx = a.lat - b.lat;
    const dy = a.lng - b.lng;
    return Math.sqrt(dx * dx + dy * dy);
  }


  function regionQuery(point) {
    return points.filter(p => distance(point, p) <= eps);
  }

  function expandCluster(point, neighbors, clusterId) {
    point.cluster = clusterId;

    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i];

      if (!visited.has(n)) {
        visited.add(n);
        const nNeighbors = regionQuery(n);
        if (nNeighbors.length >= minPts) {
          neighbors.push(...nNeighbors);
        }
      }

      if (n.cluster === undefined) {
        n.cluster = clusterId;
      }
    }
  }

  for (const point of points) {
    if (visited.has(point)) continue;

    visited.add(point);
    const neighbors = regionQuery(point);

    if (neighbors.length < minPts) {
      point.cluster = -1; // noise
    } else {
      expandCluster(point, neighbors, clusterId);
      clusterId++;
    }
  }

  return points;
}
