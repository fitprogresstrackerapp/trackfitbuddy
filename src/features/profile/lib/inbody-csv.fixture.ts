/*
 * Test fixture: the layout of a real InBody app export (45 columns, a
 * byte-order mark, "-" for values the device did not measure), with made-up
 * values. No real measurements are stored in this repository.
 */
export const INBODY_CSV_HEADER =
  'Date,Measurement device.,Weight(kg),Skeletal Muscle Mass(kg),Soft Lean Mass(kg),Body Fat Mass(kg),BMI(kg/m²),Percent Body Fat(%),Basal Metabolic Rate(kcal),InBody Age,InBody Score,Right Arm Lean Mass(kg),Left Arm Lean Mass(kg),Trunk Lean Mass(kg),Right Leg Lean Mass(kg),Left leg Lean Mass(kg),Right Arm Fat Mass(kg),Left Arm Fat Mass(kg),Trunk Fat Mass(kg),Right Leg Fat Mass(kg),Left Leg Fat Mass(kg),Right Arm ECW Ratio,Left Arm ECW Ratio,Trunk ECW Ratio,Right Leg ECW Ratio,Left Leg ECW Ratio,Waist Hip Ratio,Waist Circumference(cm),Visceral Fat Area(cm²),Visceral Fat Level(Level),Total Body Water(L),Intracellular Water(L),Extracellular Water(L),ECW Ratio,Upper-Lower,Upper,Lower,Leg Muscle Level(Level),Leg Lean Mass(kg),Protein(kg),Mineral(kg),Bone Mineral Content(kg),Body Cell Mass(kg),SMI(kg/m²),Whole Body Phase Angle(°)'

/** One data row for a timestamp (yyyymmddhhmmss); `overrides` replace cells by header. */
export function inbodyCsvRow(timestamp: string, overrides: Record<string, string> = {}): string {
  const values: Record<string, string> = {
    Date: timestamp,
    'Measurement device.': '570',
    'Weight(kg)': '81.5',
    'Skeletal Muscle Mass(kg)': '36.4',
    'Body Fat Mass(kg)': '17.1',
    'BMI(kg/m²)': '25.2',
    'Percent Body Fat(%)': '21.0',
    'Basal Metabolic Rate(kcal)': '1761',
    'InBody Score': '78.0',
    'Right Arm Lean Mass(kg)': '3.61',
    'Left Arm Lean Mass(kg)': '3.55',
    'Trunk Lean Mass(kg)': '28.4',
    'Right Leg Lean Mass(kg)': '9.82',
    'Left leg Lean Mass(kg)': '9.77',
    'Right Arm Fat Mass(kg)': '0.9',
    'Left Arm Fat Mass(kg)': '0.9',
    'Trunk Fat Mass(kg)': '10.2',
    'Right Leg Fat Mass(kg)': '2.3',
    'Left Leg Fat Mass(kg)': '2.3',
    'Visceral Fat Level(Level)': '7.0',
    'Total Body Water(L)': '47.2',
    'Upper-Lower': '1',
    Upper: '1',
    Lower: '1',
    'Protein(kg)': '12.8',
    'Mineral(kg)': '4.41',
    'SMI(kg/m²)': '8.6',
    ...overrides,
  }
  return INBODY_CSV_HEADER.split(',')
    .map((header) => values[header] ?? '-')
    .join(',')
}

/** A complete export: BOM, header, one row per timestamp. */
export function inbodyCsv(...timestamps: string[]): string {
  const rows = timestamps.map((timestamp) => inbodyCsvRow(timestamp))
  return `\uFEFF${[INBODY_CSV_HEADER, ...rows].join('\n')}\n`
}
