/* 自动生成，勿手改。scripts/gen-puzzles.mts（npm run gen） */
export type RawPuzzle = {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy'|'medium'|'hard'|'custom'
  series: string
  /** 题面串：'.' = 空地，'#' = 无数字墙，'0'-'4' = 数字墙 */
  cells: string
  /** 参考解：'o' = 灯泡，'.' = 其它；length = W*H */
  solution: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
  { id: "starter-5x5", name: "入门 · 5×5", width: 5, height: 5, difficulty: "easy", series: "starter", cells: "..0.0..3.1.3........0.0..", solution: "o.....o.o...o...o.......o" },
  { id: "starter-6x6", name: "入门 · 6×6", width: 6, height: 6, difficulty: "easy", series: "starter", cells: "0...1...3..20.1....1...2..2.2..1.2..", solution: "..o..o.o.o.......o..o...o....o..o.o." },
  { id: "starter-7x7", name: "入门 · 7×7", width: 7, height: 7, difficulty: "easy", series: "starter", cells: "..2..0.01..................2.3..02.............20", solution: ".o.o.......o........o.o.....o.o...o.....o.....o.." },
  { id: "classic-8x8-A", name: "经典 · 8×8 A", width: 8, height: 8, difficulty: "medium", series: "classic", cells: ".....01..211.1...2..1...2....0...2.0....1..1...1.....1..1.1....1", solution: ".o.....oo...o.....o...o..o......o............o.....o...o.o..o..." },
  { id: "classic-8x8-B", name: "经典 · 8×8 B", width: 8, height: 8, difficulty: "medium", series: "classic", cells: ".....2......1..0.2..11.11........0.......1.10.....1.2...1..2....", solution: "..o...o..o...o..o..o...........o.....o..o..........o.....o..o..." },
  { id: "classic-9x9", name: "经典 · 9×9", width: 9, height: 9, difficulty: "medium", series: "classic", cells: "100....1............3....1..2..2............001.0........0.....1..0...2.....0...2", solution: "......o..o.........o.o....o..o..o.......o...........o..o...............oo......o." },
  { id: "classic-10x10", name: "经典 · 10×10", width: 10, height: 10, difficulty: "medium", series: "classic", cells: ".1.00.0..21.....1...........01..10.1.200..2.....111..3.1..1...2.3.0.1.2......1.2.3..2..1.....0.....1", solution: "o.......o......o...o..o.......o.....o....o.....o....o.o....oo..o..........o...o.o.o..o...o.o.....o.." },
  { id: "challenge-10x10-B", name: "挑战 · 10×10 B", width: 10, height: 10, difficulty: "hard", series: "challenge", cells: ".........03.......0...01....3.....2....21.......1...01.2......1.3.2.........0.1.0...1...........01..", solution: "o..........o........o......o.o...o....o.....o.....o.....o......o.o..o.....o..............o..o.....o." },
  { id: "challenge-12x12", name: "挑战 · 12×12", width: 12, height: 12, difficulty: "hard", series: "challenge", cells: ".3............30...1.100....1......0...2.2...1....1.3.....1.01..11..1...2..1.10.1.11..........0.....01.1..1..0.02..01....0.1.3.1.1...0.0......1.", solution: "o.o..........o...o..o.....o...o.........o.....o....o.o.............o...o.o..o....o..o.............o.....o..o.....o..........o.o...o.........o..." },
]
