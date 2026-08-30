/**
 * Brushed/brushless DC motor model.
 * Ported from PathPlanner (MIT) lib/trajectory/dc_motor.dart — algorithm
 * preserved 1:1 (constructor math, Kraken/Falcon/NEO/Vortex/CIM tables).
 */

const RPM_TO_RAD = (Math.PI * 2) / 60;

export class DCMotor {
  readonly nominalVoltageVolts: number;
  readonly stallTorqueNM: number;
  readonly stallCurrentAmps: number;
  readonly freeCurrentAmps: number;
  readonly freeSpeedRadPerSec: number;
  readonly rOhms: number;
  readonly kVRadPerSecPerVolt: number;
  readonly kTNMPerAmp: number;

  constructor(
    nominalVoltageVolts: number,
    stallTorqueNM: number,
    stallCurrentAmps: number,
    freeCurrentAmps: number,
    freeSpeedRadPerSec: number,
    numMotors: number,
  ) {
    this.nominalVoltageVolts = nominalVoltageVolts;
    this.stallTorqueNM = stallTorqueNM * numMotors;
    this.stallCurrentAmps = stallCurrentAmps * numMotors;
    this.freeCurrentAmps = freeCurrentAmps * numMotors;
    this.freeSpeedRadPerSec = freeSpeedRadPerSec;
    this.rOhms = this.nominalVoltageVolts / this.stallCurrentAmps;
    this.kTNMPerAmp = this.stallTorqueNM / this.stallCurrentAmps;
    this.kVRadPerSecPerVolt =
      this.freeSpeedRadPerSec /
      (this.nominalVoltageVolts - this.rOhms * this.freeCurrentAmps);
  }

  /** Current draw at the given rotor speed and applied voltage. */
  current(speedRadPerSec: number, voltage: number): number {
    return (
      (-1.0 / this.kVRadPerSecPerVolt / this.rOhms) * speedRadPerSec +
      (1.0 / this.rOhms) * voltage
    );
  }

  /** Torque produced at the given current. */
  torque(currentAmps: number): number {
    return currentAmps * this.kTNMPerAmp;
  }

  withReduction(gearboxReduction: number): DCMotor {
    // Mirrors the Dart original: scale torque up / speed down, single motor.
    return new DCMotor(
      this.nominalVoltageVolts,
      this.stallTorqueNM * gearboxReduction,
      this.stallCurrentAmps,
      this.freeCurrentAmps,
      this.freeSpeedRadPerSec / gearboxReduction,
      1,
    );
  }

  static getCIM(numMotors = 1): DCMotor {
    return new DCMotor(12, 2.42, 133, 2.7, 5310 * RPM_TO_RAD, numMotors);
  }
  static getNEO(numMotors = 1): DCMotor {
    return new DCMotor(12, 2.6, 105, 1.8, 5676 * RPM_TO_RAD, numMotors);
  }
  static getMiniCIM(numMotors = 1): DCMotor {
    return new DCMotor(12, 1.41, 89, 3, 5840 * RPM_TO_RAD, numMotors);
  }
  static getFalcon500(numMotors = 1): DCMotor {
    return new DCMotor(12, 4.69, 257, 1.5, 6380 * RPM_TO_RAD, numMotors);
  }
  static getFalcon500FOC(numMotors = 1): DCMotor {
    return new DCMotor(12, 5.84, 304, 1.5, 6080 * RPM_TO_RAD, numMotors);
  }
  static getKrakenX60(numMotors = 1): DCMotor {
    return new DCMotor(12, 7.09, 366, 2, 6000 * RPM_TO_RAD, numMotors);
  }
  static getKrakenX60FOC(numMotors = 1): DCMotor {
    return new DCMotor(12, 9.37, 483, 2, 5800 * RPM_TO_RAD, numMotors);
  }
  static getNeoVortex(numMotors = 1): DCMotor {
    return new DCMotor(12, 3.6, 211, 3.6, 6784 * RPM_TO_RAD, numMotors);
  }

  static fromString(str: string, numMotors = 1): DCMotor {
    switch (str) {
      case 'krakenX60': return DCMotor.getKrakenX60(numMotors);
      case 'krakenX60FOC': return DCMotor.getKrakenX60FOC(numMotors);
      case 'falcon500': return DCMotor.getFalcon500(numMotors);
      case 'falcon500FOC': return DCMotor.getFalcon500FOC(numMotors);
      case 'vortex': return DCMotor.getNeoVortex(numMotors);
      case 'NEO': return DCMotor.getNEO(numMotors);
      case 'CIM': return DCMotor.getCIM(numMotors);
      case 'miniCIM': return DCMotor.getMiniCIM(numMotors);
      default: return DCMotor.getKrakenX60(numMotors);
    }
  }
}
