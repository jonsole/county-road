import { tireForces } from './tires.js'

const MASS = 1450
const INERTIA = 2360
const FRONT = 1.23
const REAR = 1.39
const TRACK = 1.6
const GRAVITY = 9.81
const GEARS = [3.42, 2.23, 1.58, 1.19, 0.94, 0.77]
const FINAL_DRIVE = 3.63
const WHEEL_RADIUS = 0.33
const NEUTRAL_IDLE_RPM = 700
const WHEELS = [[-1, FRONT], [1, FRONT], [-1, -REAR], [1, -REAR]]
export const STEP = 1 / 120
export const NEUTRAL = { steer: 0, throttle: 0, brake: 0 }
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export function createCar({ x = 0, z = 0, heading = 0 } = {}) {
  return {
    x, z, heading, u: 0, v: 0, yaw: 0, steer: 0, gear: 1, reverse: false, manual: false,
    rpm: 850, ax: 0, ay: 0, shiftDelay: 0, slip: 0, pavedSlip: 0, wheelAngle: 0,
  }
}

const wheelRpmAt = speed => Math.abs(speed) * 60 / (2 * Math.PI * WHEEL_RADIUS)

export function shiftGear(car, direction) {
  if (!car.manual || car.shiftDelay > 0.06) return
  const current = car.reverse ? -1 : car.gear
  const gear = clamp(current + direction, -1, GEARS.length)
  if (gear === current) return
  if (gear === -1 && Math.hypot(car.u, car.v) >= 0.5) return
  if (current === 0 && gear === 1 && car.u <= -0.5) return
  if (gear > 0 && (direction < 0 || current === 0)
    && wheelRpmAt(car.u) * GEARS[gear - 1] * FINAL_DRIVE > 6900) return
  car.reverse = gear < 0
  car.gear = Math.max(0, gear)
  car.shiftDelay = 0.18
}

const FLAT = () => [0, 0]
const gradient = [0, 0]

/**
 * One physics step. isPaved(x, z) gives each tyre's surface; slope(x, z, out)
 * the ground's gradient [dh/dx, dh/dz] under the car (flat if left out):
 * gravity pulls along it, and it shares out the weight on the tyres.
 */
export function stepCar(car, input, isPaved, slope = FLAT) {
  const { u, v, yaw } = car
  const speed = Math.hypot(u, v)
  const cos = Math.cos(car.heading)
  const sin = Math.sin(car.heading)
  // Retain enough road-wheel angle for the tyres to build cornering force at speed.
  const highSpeedRange = 0.024 * clamp((Math.abs(u) - 25) / 20, 0, 1)
  const steerLimit = Math.min(0.54, Math.atan2((FRONT + REAR) * 20, u ** 2 + 55) + highSpeedRange)
  const keyboardRange = input.keyboardSteering ? 1 - 0.32 * clamp((speed - 6) / 10, 0, 1) : 1
  const desiredSteer = input.steer * steerLimit * keyboardRange
  const steerRate = input.keyboardSteering ? 1.45 : 3.2
  car.steer += clamp(desiredSteer - car.steer, -steerRate * STEP, steerRate * STEP)
  const steerCos = Math.cos(car.steer)
  const steerSin = Math.sin(car.steer)

  const wheelRpm = wheelRpmAt(u)
  if (!car.manual && !car.reverse && car.gear === 0) {
    const safeGear = GEARS.findIndex(gear => wheelRpm * gear * FINAL_DRIVE <= 6450)
    car.gear = safeGear === -1 ? GEARS.length : safeGear + 1
  }
  car.shiftDelay = Math.max(0, car.shiftDelay - STEP)
  if (!car.manual && !car.reverse && car.shiftDelay === 0) {
    const currentRpm = wheelRpm * GEARS[car.gear - 1] * FINAL_DRIVE
    const downshiftRpm = car.gear > 1 ? wheelRpm * GEARS[car.gear - 2] * FINAL_DRIVE : Infinity
    if (currentRpm > 6450 && car.gear < GEARS.length) {
      car.gear++
      car.shiftDelay = 0.22
    } else if (downshiftRpm < (input.throttle > 0.65 ? 4750 : 3000)) {
      car.gear--
      car.shiftDelay = 0.22
    }
  }
  const ratio = (car.reverse ? 3.25 : GEARS[car.gear - 1] ?? 0) * FINAL_DRIVE
  const neutralRpm = NEUTRAL_IDLE_RPM + (6900 - NEUTRAL_IDLE_RPM) * input.throttle
  car.rpm = ratio === 0
    ? car.rpm + (neutralRpm - car.rpm) * 0.07
    : clamp(wheelRpm * ratio, 850, 6900)
  const torque = 445 * (0.77 + 0.23 * Math.sin(Math.PI * car.rpm / 7600))
  const limiter = clamp((7000 - car.rpm) / 650, 0, 1) * (car.reverse ? clamp((9 - speed) / 2, 0, 1) : 1)
  const drive = input.throttle * torque * ratio * 0.88 * limiter / WHEEL_RADIUS
    * (car.reverse ? -1 : 1) * (car.shiftDelay > 0.1 ? 0.38 : 1)

  const wheelbase = FRONT + REAR
  const frontLoad = MASS * GRAVITY * REAR / wheelbase
  const pitch = clamp(MASS * car.ax * 0.51 / wheelbase, -3500, 3500)
  const roll = clamp(MASS * car.ay * 0.51 / TRACK, -3400, 3400)
  // Gravity down the slope: the grade along the car and across it.
  const [gx, gz] = slope(car.x, car.z, gradient)
  const gradeForward = gx * sin + gz * cos
  const gradeRight = -gx * cos + gz * sin
  const tilt = 1 / Math.sqrt(1 + gradeForward ** 2 + gradeRight ** 2)
  const gravityForward = -MASS * GRAVITY * gradeForward * tilt
  const gravityRight = -MASS * GRAVITY * gradeRight * tilt
  let forwardForce = -0.43 * u * Math.abs(u) + gravityForward
  let rightForce = gravityRight
  let moment = 0
  let rearSlip = 0
  let pavedSlip = 0

  for (const [side, forwardOffset] of WHEELS) {
    const front = forwardOffset > 0
    const rightOffset = side * TRACK / 2
    // The camera faces +Z at zero heading, so screen-right points toward -X.
    const wheelX = car.x - rightOffset * cos + forwardOffset * sin
    const wheelZ = car.z + rightOffset * sin + forwardOffset * cos
    const paved = isPaved(wheelX, wheelZ)
    const load = Math.max(400, ((front ? frontLoad - pitch : MASS * GRAVITY - frontLoad + pitch) / 2
      - roll * side * (front ? 0.53 : 0.47)) * tilt)
    const c = front ? steerCos : 1
    const s = front ? steerSin : 0
    const wheelForward = u - yaw * rightOffset
    const wheelRight = v + yaw * forwardOffset
    const longitudinal = wheelForward * c + wheelRight * s
    const lateral = wheelRight * c - wheelForward * s
    const braking = input.brake * (front ? 5600 : 3300)
    const engineDrag = front || ratio === 0 || input.throttle > 0.03 ? 0 : 125
    const { fx, fy, slipAngle } = tireForces(paved, load, longitudinal, lateral,
      front ? 0 : drive / 2, braking + engineDrag, front, MASS / (4 * STEP))
    const localForward = fx * c - fy * s
    const localRight = fx * s + fy * c
    forwardForce += localForward
    rightForce += localRight
    moment += forwardOffset * localRight - rightOffset * localForward
    const contactSlip = Math.abs(slipAngle)
    if (!front) rearSlip = Math.max(rearSlip, contactSlip)
    if (paved) pavedSlip = Math.max(pavedSlip, contactSlip)
  }

  // (What the body feels, for weight transfer and lean: not gravity's pull.)
  car.ax += ((forwardForce - gravityForward) / MASS - car.ax) * 0.08
  car.ay += ((rightForce - gravityRight) / MASS - car.ay) * 0.08
  car.slip = rearSlip
  car.pavedSlip = pavedSlip
  car.u += (forwardForce / MASS + yaw * v) * STEP
  car.v += (rightForce / MASS - yaw * u) * STEP
  car.yaw += moment / INERTIA * STEP
  // At a standstill the car holds (as if on the handbrake), unless the slope is too steep to hold.
  if (speed < 0.12 && input.throttle < 0.015 && Math.hypot(gradeForward, gradeRight) < 0.45) car.u = car.v = car.yaw = 0
  car.wheelAngle += (u + car.u) * 0.5 * STEP / WHEEL_RADIUS
  car.heading -= car.yaw * STEP
  car.x += (Math.sin(car.heading) * car.u - Math.cos(car.heading) * car.v) * STEP
  car.z += (Math.cos(car.heading) * car.u + Math.sin(car.heading) * car.v) * STEP
}

export function createStepper(update) {
  let accumulator = 0
  return elapsed => {
    accumulator += Math.min(elapsed, 0.1)
    while (accumulator + 1e-9 >= STEP) {
      update()
      accumulator = Math.max(0, accumulator - STEP)
    }
    return accumulator / STEP
  }
}

const PRESENTATION_FIELDS = ['x', 'z', 'heading', 'u', 'steer', 'ax', 'ay', 'wheelAngle']

export function interpolateCarPose(previous, current, fraction, output) {
  for (const field of PRESENTATION_FIELDS) {
    output[field] = previous[field] + (current[field] - previous[field]) * fraction
  }
  return output
}
