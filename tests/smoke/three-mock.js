// Stand-in for Three.js: every class/method exists and returns another stand-in.
function mock() {
  const store = {};
  return new Proxy(function () {}, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined;
      if (p === Symbol.iterator) return function* () {};
      if (!(p in store)) store[p] = mock();
      return store[p];
    },
    set(t, p, v) { store[p] = v; return true; },
    apply() { return mock(); },
    construct() { return mock(); },
  });
}
export const AdditiveBlending = mock();
export const BoxGeometry = mock();
export const BufferAttribute = mock();
export const BufferGeometry = mock();
export const CanvasTexture = mock();
export const CircleGeometry = mock();
export const Color = mock();
export const ConeGeometry = mock();
export const CylinderGeometry = mock();
export const DirectionalLight = mock();
export const DoubleSide = mock();
export const EdgesGeometry = mock();
export const Euler = mock();
export const Fog = mock();
export const Group = mock();
export const HemisphereLight = mock();
export const InstancedMesh = mock();
export const LineBasicMaterial = mock();
export const LineSegments = mock();
export const Matrix4 = mock();
export const Mesh = mock();
export const MeshBasicMaterial = mock();
export const MeshStandardMaterial = mock();
export const OctahedronGeometry = mock();
export const Path = mock();
export const PerspectiveCamera = mock();
export const Plane = mock();
export const PlaneGeometry = mock();
export const PointLight = mock();
export const Points = mock();
export const PointsMaterial = mock();
export const Quaternion = mock();
export const Raycaster = mock();
export const RingGeometry = mock();
export const Scene = mock();
export const Shape = mock();
export const ShapeGeometry = mock();
export const SphereGeometry = mock();
export const TorusGeometry = mock();
export const Vector2 = mock();
export const Vector3 = mock();
export const WebGLRenderer = mock();
