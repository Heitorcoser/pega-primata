// Port fiel (linha a linha) do sistema de locomoção por braços que a Another Axiom
// publicou como código aberto (licença MIT): github.com/Another-Axiom/GorillaLocomotion (Player.cs).
// Valores padrão = os do prefab "Gorilla Rig" do pacote oficial.
//
// Ideia central: as mãos são esferas que colidem com o mundo. Quando a mão encosta numa
// superfície ela "gruda" no ponto tocado, e o corpo inteiro (o rig) é deslocado pelo
// inverso do movimento da mão. Ao soltar, a média de velocidade dos últimos quadros
// vira impulso (pulo) — com limite máximo e multiplicador.
import * as THREE from 'three';
import { Hit } from './physics.js';

export const DEFAULT_PARAMS = {
  velocityHistorySize: 8,
  maxArmLength: 1.5,
  unStickDistance: 1,
  velocityLimit: 0.4,
  maxJumpSpeed: 6.5,
  jumpMultiplier: 1.1,
  minimumRaycastDistance: 0.05, // raio da esfera da mão
  defaultSlideFactor: 0.03,
  defaultPrecision: 0.995,
  headRadius: 0.15,
};

export class ArmLocomotion {
  /**
   * @param world PhysicsWorld
   * @param player objeto com: rigPosition (Vector3), velocity (Vector3),
   *        headWorld(out), handWorld(isLeft, out), turnRig(deg)
   */
  constructor(world, player, params = {}) {
    this.world = world;
    this.player = player;
    this.p = { ...DEFAULT_PARAMS, ...params };
    this.disableMovement = false;

    this.lastLeftHandPosition = new THREE.Vector3();
    this.lastRightHandPosition = new THREE.Vector3();
    this.lastHeadPosition = new THREE.Vector3();
    this.lastPosition = new THREE.Vector3();
    this.velocityHistory = [];
    this.velocityIndex = 0;
    this.currentVelocity = new THREE.Vector3();
    this.denormalizedVelocityAverage = new THREE.Vector3();
    this.wasLeftHandTouching = false;
    this.wasRightHandTouching = false;
    this.leftTouchCollider = null;
    this.rightTouchCollider = null;
    this.onHandTouch = null; // callback(isLeft, collider)

    // temporários (evita alocar por quadro)
    this._hit = new Hit();
    this._inner = new Hit();
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
    this._first = new THREE.Vector3(); this._proj = new THREE.Vector3(); this._start = new THREE.Vector3();
    this._fp = new THREE.Vector3(); this._dist = new THREE.Vector3(); this._rbm = new THREE.Vector3();
    this._fl = new THREE.Vector3(); this._fr = new THREE.Vector3();
    this._curL = new THREE.Vector3(); this._curR = new THREE.Vector3();
    this._head = new THREE.Vector3(); this._raw = new THREE.Vector3();
    this._lastHitCollider = null;

    this.initializeValues();
  }

  initializeValues() {
    const n = this.p.velocityHistorySize;
    this.velocityHistory = Array.from({ length: n }, () => new THREE.Vector3());
    this.velocityIndex = 0;
    this.denormalizedVelocityAverage.set(0, 0, 0);
    this.currentLeftHandPosition(this.lastLeftHandPosition);
    this.currentRightHandPosition(this.lastRightHandPosition);
    this.player.headWorld(this.lastHeadPosition);
    this.lastPosition.copy(this.player.rigPosition);
    this.wasLeftHandTouching = this.wasRightHandTouching = false;
  }

  _currentHand(isLeft, out) {
    const head = this.player.headWorld(this._head);
    const raw = this.player.handWorld(isLeft, this._raw);
    const d = this._a.copy(raw).sub(head);
    if (d.length() < this.p.maxArmLength) return out.copy(raw);
    return out.copy(head).add(d.normalize().multiplyScalar(this.p.maxArmLength));
  }
  currentLeftHandPosition(out) { return this._currentHand(true, out); }
  currentRightHandPosition(out) { return this._currentHand(false, out); }

  update(dt) {
    const p = this.p;
    const pl = this.player;
    let leftHandColliding = false;
    let rightHandColliding = false;
    const finalPosition = this._fp;
    const rigidBodyMovement = this._rbm.set(0, 0, 0);
    const firstIterationLeftHand = this._fl.set(0, 0, 0);
    const firstIterationRightHand = this._fr.set(0, 0, 0);
    const hitInfo = this._hit;
    const distanceTraveled = this._dist;
    const curL = this._curL, curR = this._curR;
    const gravityNudge = 2 * 9.8 * dt * dt;
    let leftCol = null, rightCol = null;

    // mão esquerda
    this.currentLeftHandPosition(curL);
    distanceTraveled.copy(curL).sub(this.lastLeftHandPosition);
    distanceTraveled.y -= gravityNudge;
    if (this.iterativeCollisionSphereCast(this.lastLeftHandPosition, p.minimumRaycastDistance, distanceTraveled, p.defaultPrecision, finalPosition, true)) {
      // gruda no ponto tocado: enquanto continuar tocando, esse é o "ponto zero" da mão
      if (this.wasLeftHandTouching) firstIterationLeftHand.copy(this.lastLeftHandPosition).sub(curL);
      else firstIterationLeftHand.copy(finalPosition).sub(curL);
      pl.velocity.set(0, 0, 0);
      leftHandColliding = true;
      leftCol = this._lastHitCollider;
    }

    // mão direita
    this.currentRightHandPosition(curR);
    distanceTraveled.copy(curR).sub(this.lastRightHandPosition);
    distanceTraveled.y -= gravityNudge;
    if (this.iterativeCollisionSphereCast(this.lastRightHandPosition, p.minimumRaycastDistance, distanceTraveled, p.defaultPrecision, finalPosition, true)) {
      if (this.wasRightHandTouching) firstIterationRightHand.copy(this.lastRightHandPosition).sub(curR);
      else firstIterationRightHand.copy(finalPosition).sub(curR);
      pl.velocity.set(0, 0, 0);
      rightHandColliding = true;
      rightCol = this._lastHitCollider;
    }

    // média ou soma
    if ((leftHandColliding || this.wasLeftHandTouching) && (rightHandColliding || this.wasRightHandTouching)) {
      rigidBodyMovement.copy(firstIterationLeftHand).add(firstIterationRightHand).multiplyScalar(0.5);
    } else {
      rigidBodyMovement.copy(firstIterationLeftHand).add(firstIterationRightHand);
    }

    // valida o movimento da cabeça
    const head = pl.headWorld(this._c);
    const headMove = this._b.copy(head).add(rigidBodyMovement).sub(this.lastHeadPosition);
    if (this.iterativeCollisionSphereCast(this.lastHeadPosition, p.headRadius, headMove, p.defaultPrecision, finalPosition, false)) {
      rigidBodyMovement.copy(finalPosition).sub(this.lastHeadPosition);
      // última checagem para a cabeça não atravessar geometria
      const dir = this._b.copy(head).sub(this.lastHeadPosition).add(rigidBodyMovement);
      if (this.world.raycast(this.lastHeadPosition, dir, dir.length() + p.headRadius * p.defaultPrecision * 0.999, hitInfo)) {
        rigidBodyMovement.copy(this.lastHeadPosition).sub(head);
      }
    }

    if (rigidBodyMovement.x !== 0 || rigidBodyMovement.y !== 0 || rigidBodyMovement.z !== 0) {
      pl.rigPosition.add(rigidBodyMovement);
    }

    pl.headWorld(this.lastHeadPosition);

    // posição final da mão esquerda
    this.currentLeftHandPosition(curL);
    distanceTraveled.copy(curL).sub(this.lastLeftHandPosition);
    let both = (leftHandColliding || this.wasLeftHandTouching) && (rightHandColliding || this.wasRightHandTouching);
    if (this.iterativeCollisionSphereCast(this.lastLeftHandPosition, p.minimumRaycastDistance, distanceTraveled, p.defaultPrecision, finalPosition, !both)) {
      this.lastLeftHandPosition.copy(finalPosition);
      leftHandColliding = true;
      leftCol = leftCol || this._lastHitCollider;
    } else {
      this.lastLeftHandPosition.copy(curL);
    }

    // posição final da mão direita
    this.currentRightHandPosition(curR);
    distanceTraveled.copy(curR).sub(this.lastRightHandPosition);
    both = (leftHandColliding || this.wasLeftHandTouching) && (rightHandColliding || this.wasRightHandTouching);
    if (this.iterativeCollisionSphereCast(this.lastRightHandPosition, p.minimumRaycastDistance, distanceTraveled, p.defaultPrecision, finalPosition, !both)) {
      this.lastRightHandPosition.copy(finalPosition);
      rightHandColliding = true;
      rightCol = rightCol || this._lastHitCollider;
    } else {
      this.lastRightHandPosition.copy(curR);
    }

    this.storeVelocities(dt);

    if ((rightHandColliding || leftHandColliding) && !this.disableMovement) {
      const mag = this.denormalizedVelocityAverage.length();
      if (mag > p.velocityLimit) {
        if (mag * p.jumpMultiplier > p.maxJumpSpeed) {
          pl.velocity.copy(this.denormalizedVelocityAverage).normalize().multiplyScalar(p.maxJumpSpeed);
        } else {
          pl.velocity.copy(this.denormalizedVelocityAverage).multiplyScalar(p.jumpMultiplier);
        }
      }
    }

    // mão esquerda presa longe demais? solta
    pl.headWorld(head);
    this.currentLeftHandPosition(curL);
    if (leftHandColliding && this._a.copy(curL).sub(this.lastLeftHandPosition).length() > p.unStickDistance) {
      const toHand = this._b.copy(curL).sub(head);
      if (!this.world.sphereCast(head, p.minimumRaycastDistance * p.defaultPrecision, toHand, toHand.length() - p.minimumRaycastDistance, hitInfo)) {
        this.lastLeftHandPosition.copy(curL);
        leftHandColliding = false;
      }
    }

    // mão direita presa longe demais? solta
    this.currentRightHandPosition(curR);
    if (rightHandColliding && this._a.copy(curR).sub(this.lastRightHandPosition).length() > p.unStickDistance) {
      const toHand = this._b.copy(curR).sub(head);
      if (!this.world.sphereCast(head, p.minimumRaycastDistance * p.defaultPrecision, toHand, toHand.length() - p.minimumRaycastDistance, hitInfo)) {
        this.lastRightHandPosition.copy(curR);
        rightHandColliding = false;
      }
    }

    // eventos de toque (som / vibração) — não existe no Player.cs, é só feedback
    if (this.onHandTouch) {
      if (leftHandColliding && !this.wasLeftHandTouching) this.onHandTouch(true, leftCol);
      if (rightHandColliding && !this.wasRightHandTouching) this.onHandTouch(false, rightCol);
    }

    this.wasLeftHandTouching = leftHandColliding;
    this.wasRightHandTouching = rightHandColliding;
  }

  iterativeCollisionSphereCast(startPosition, sphereRadius, movementVector, precision, endPosition, singleHand) {
    const hitInfo = this._hit;
    const start = this._start.copy(startPosition);
    const move = this._proj.copy(movementVector); // cópia (movementVector pode ser reutilizado)
    const moveCopy = new THREE.Vector3().copy(move);
    if (this.collisionsSphereCast(start, sphereRadius * precision, moveCopy, precision, endPosition, hitInfo)) {
      // ao tocar, desliza um pouco ao longo do plano da superfície
      const firstPosition = this._first.copy(endPosition);
      const surf = hitInfo.collider && hitInfo.collider.surface;
      const slipPercentage = (surf && surf.slip !== undefined) ? surf.slip : (!singleHand ? this.p.defaultSlideFactor : 0.001);
      const target = new THREE.Vector3().copy(start).add(moveCopy).sub(firstPosition);
      const n = hitInfo.normal;
      const movementToProjectedAboveCollisionPlane = target.sub(this._a.copy(n).multiplyScalar(target.dot(n))).multiplyScalar(slipPercentage);
      this._lastHitCollider = hitInfo.collider;
      if (this.collisionsSphereCast(firstPosition, sphereRadius, movementToProjectedAboveCollisionPlane, precision * precision, endPosition, hitInfo)) {
        return true;
      }
      const from = new THREE.Vector3().copy(movementToProjectedAboveCollisionPlane).add(firstPosition);
      const toTrue = new THREE.Vector3().copy(start).add(moveCopy).sub(from);
      if (this.collisionsSphereCast(from, sphereRadius, toTrue, precision * precision * precision, endPosition, hitInfo)) {
        return true;
      }
      endPosition.copy(firstPosition);
      return true;
    }
    // checagem de sanidade com esfera menor (caso já estivesse encostando)
    const mag = moveCopy.length();
    const smallMove = new THREE.Vector3();
    if (mag > 0) smallMove.copy(moveCopy).multiplyScalar(1 / mag).multiplyScalar(mag + sphereRadius * precision * 0.34);
    if (this.collisionsSphereCast(start, sphereRadius * precision * 0.66, smallMove, precision * 0.66, endPosition, hitInfo)) {
      endPosition.copy(start);
      this._lastHitCollider = hitInfo.collider;
      return true;
    }
    endPosition.set(0, 0, 0);
    return false;
  }

  collisionsSphereCast(startPosition, sphereRadius, movementVector, precision, finalPosition, hitInfo) {
    const w = this.world;
    const start = new THREE.Vector3().copy(startPosition);
    const inner = this._inner;
    if (w.sphereCast(start, sphereRadius * precision, movementVector, movementVector.length() + sphereRadius * (1 - precision), hitInfo)) {
      // queremos ficar a exatamente sphereRadius da superfície
      finalPosition.copy(hitInfo.point).addScaledVector(hitInfo.normal, sphereRadius);
      const toFinal = new THREE.Vector3().copy(finalPosition).sub(start);
      if (w.sphereCast(start, sphereRadius * precision * precision, toFinal, toFinal.length() + sphereRadius * (1 - precision * precision), inner)) {
        const len = toFinal.length();
        const k = Math.max(0, hitInfo.distance - sphereRadius * (1 - precision * precision));
        if (len > 0) finalPosition.copy(start).addScaledVector(toFinal, k / len);
        else finalPosition.copy(start);
        hitInfo.copy(inner);
      } else if (w.raycast(start, toFinal, toFinal.length() + sphereRadius * precision * precision * 0.999, inner)) {
        // raycast extra contra atravessar geometria
        finalPosition.copy(start);
        hitInfo.copy(inner);
        return true;
      }
      return true;
    } else if (w.raycast(start, movementVector, movementVector.length() + sphereRadius * precision * 0.999, hitInfo)) {
      finalPosition.copy(start);
      return true;
    }
    finalPosition.set(0, 0, 0);
    return false;
  }

  // Turn(degrees) do original: gira o rig em volta da cabeça e o histórico de velocidade
  turn(degrees) {
    this.player.turnRig(degrees);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(degrees));
    this.denormalizedVelocityAverage.applyQuaternion(q);
    for (const v of this.velocityHistory) v.applyQuaternion(q);
  }

  storeVelocities(dt) {
    const n = this.p.velocityHistorySize;
    this.velocityIndex = (this.velocityIndex + 1) % n;
    const oldestVelocity = this.velocityHistory[this.velocityIndex];
    this.currentVelocity.copy(this.player.rigPosition).sub(this.lastPosition).divideScalar(dt);
    this.denormalizedVelocityAverage.addScaledVector(this._a.copy(this.currentVelocity).sub(oldestVelocity), 1 / n);
    oldestVelocity.copy(this.currentVelocity);
    this.lastPosition.copy(this.player.rigPosition);
  }
}
