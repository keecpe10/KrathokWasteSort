/**
 * บล็อกสำหรับการแข่งขันหุ่นยนต์อัตโนมัติ "แยกขยะ" รุ่นอายุไม่เกิน 12 ปี
 * (ศรีสะเกษโรโบติกส์ 2026) ใช้คู่กับส่วนขยาย KrathokKidsBit
 *
 * แผนที่สนาม (มองจากด้านบน START อยู่ด้านบน)
 *
 *   [ถังดำ]            [START]            [ถังขาว]
 *      |                  |                  |
 *   1  +-----+-----+-----+-----+-----+-----+-+   แถว 1
 *      |     |     |     |     |     |     |
 *   2  +-----+-----+-----+-----+-----+-----+     แถว 2   (ระยะแถว 200 มม.)
 *      ...
 *   4  +-----+-----+-----+-----+                 แถว 4
 *                         |
 *                   (จุดวางกระป๋อง)
 *
 *   คอลัมน์ 1-5 จากซ้ายไปขวา ห่างกัน 500 มม. ถังดำอยู่บนคอลัมน์ 1
 *   START อยู่บนคอลัมน์ 3 ถังขาวอยู่บนคอลัมน์ 5 จุดวางกระป๋องอยู่ใต้คอลัมน์ 3
 *
 * สิ่งกีดขวาง 4 ชิ้นวางทับทางแยก ให้บอกตำแหน่งด้วยบล็อก "มีสิ่งกีดขวางที่"
 * แล้วหุ่นจะหาเส้นทางอ้อมเองทุกครั้ง
 */

enum Waste_Color {
    //% block="ขาว"
    White,
    //% block="ดำ"
    Black
}

enum Waste_Row {
    //% block="1 (บนสุด ใกล้ START)"
    R1,
    //% block="2"
    R2,
    //% block="3"
    R3,
    //% block="4 (ล่างสุด ใกล้จุดวางกระป๋อง)"
    R4
}

enum Waste_Col {
    //% block="1 (ซ้ายสุด)"
    C1,
    //% block="2"
    C2,
    //% block="3 (กลาง)"
    C3,
    //% block="4"
    C4,
    //% block="5 (ขวาสุด)"
    C5
}

enum Waste_Side {
    //% block="ซ้าย"
    Left,
    //% block="ขวา"
    Right
}

enum Waste_PickMode {
    //% block="อัลตราโซนิก หยุดเมื่อใกล้กว่า (ซม.)"
    Ultrasonic,
    //% block="จับเวลา เดินตามเส้นนาน (วินาที)"
    Timed
}

//% color="#2E7D32" weight=90 icon="" block="แยกขยะ"
//% groups='["ตั้งค่าสนาม", "ตั้งค่าหุ่น", "ภารกิจ", "ทีละขั้น", "ตรวจสอบ"]'
namespace WasteSort {
    // ---------- แผนที่ ----------
    const ROWS = 4
    const COLS = 5
    const MID = 2           // คอลัมน์กลาง (START และจุดวางกระป๋อง)
    // ทิศบนแผนที่: 0 = ขึ้น (ไป START), 1 = ขวา, 2 = ลง (ไปจุดวางกระป๋อง), 3 = ซ้าย
    const N = 0
    const E = 1
    const S = 2
    const W = 3
    // ต้นทุนใช้เลือกเส้นทางที่เร็วที่สุด คิดเป็นระยะทางโดยประมาณ (หน่วย 100 มม.)
    const COST_V = 2        // เส้นแนวตั้ง 200 มม.
    const COST_H = 5        // เส้นแนวนอน 500 มม.
    const COST_TURN = 3     // เลี้ยวจนเจอเส้นหนึ่งครั้ง
    const INF = 9999

    let blocked: boolean[] = []
    for (let i = 0; i < ROWS * COLS; i++) blocked.push(false)
    let blackCol = 0
    let whiteCol = COLS - 1

    // ลำดับสีกระป๋อง 8 ใบ (ค่าเริ่มต้นตามตัวอย่างในกติกา)
    let canColors = [
        Waste_Color.White, Waste_Color.Black, Waste_Color.White, Waste_Color.Black,
        Waste_Color.White, Waste_Color.Black, Waste_Color.Black, Waste_Color.White
    ]

    // ---------- ค่าของหุ่น ----------
    let lineSpeed = 40
    let turnSpeed = 50
    let pickMode = Waste_PickMode.Ultrasonic
    let pickValue = 6
    let binIn = 0
    let binBack = 0.3
    let parkIn = 0.5

    // ---------- ตำแหน่งหุ่น ----------
    let curR = 0
    let curC = MID
    let curD = S
    // true = หุ่นอยู่บนเส้นสั้นที่ต่อกับทางแยก (curR, curC) และหันเข้าหาทางแยกนั้น ยังไม่ถึง
    let pending = false
    let inStart = true

    // =====================================================
    // แผนที่และการหาเส้นทาง
    // =====================================================

    function idx(r: number, c: number): number {
        return r * COLS + c
    }

    // ทางแยก (r, c) มีเส้นออกไปทางทิศ d หรือไม่ (ไม่สนสิ่งกีดขวาง เพราะเส้นยังมองเห็นได้)
    function hasBranch(r: number, c: number, d: number): boolean {
        if (d == N) return r > 0 || c == blackCol || c == MID || c == whiteCol
        if (d == S) return r < ROWS - 1 || c == MID
        if (d == E) return c < COLS - 1
        return c > 0
    }

    // จำนวนครั้งที่ต้องสั่ง "เลี้ยวจนเจอเส้น" เพื่อหมุนจากทิศ from ไปทิศ to
    // เลี้ยวซ้าย (left = true) หรือขวา นับทุกเส้นที่กวาดผ่านรวมเส้นปลายทาง
    function turnCalls(r: number, c: number, from: number, to: number, left: boolean): number {
        let n = 0
        let d = from
        while (d != to) {
            d = left ? (d + 3) % 4 : (d + 1) % 4
            if (hasBranch(r, c, d)) n++
        }
        return n
    }

    function bestTurnLeft(r: number, c: number, from: number, to: number): boolean {
        let nl = turnCalls(r, c, from, to, true)
        let nr = turnCalls(r, c, from, to, false)
        if (nl != nr) return nl < nr
        // เท่ากัน เลือกทางที่หมุนน้อยองศากว่า (กลับหลังหันเลือกซ้าย)
        return (from - to + 4) % 4 <= (to - from + 4) % 4
    }

    function turnCost(r: number, c: number, from: number, to: number): number {
        let left = bestTurnLeft(r, c, from, to)
        return turnCalls(r, c, from, to, left) * COST_TURN
    }

    // สถานะ = (ทางแยก, ทิศที่หัน)  s = idx * 4 + d
    // คืนรายการสถานะจากจุดเริ่มถึงเป้าหมาย หรือรายการว่างถ้าไปไม่ได้
    // goalD = -1 แปลว่าหันทิศไหนก็ได้
    function plan(r0: number, c0: number, d0: number, gr: number, gc: number, goalD: number): number[] {
        let total = ROWS * COLS * 4
        let dist: number[] = []
        let prev: number[] = []
        let done: boolean[] = []
        for (let i = 0; i < total; i++) {
            dist.push(INF)
            prev.push(-1)
            done.push(false)
        }
        let start = idx(r0, c0) * 4 + d0
        dist[start] = 0
        let goal = -1
        while (true) {
            let s = -1
            let best = INF
            for (let i = 0; i < total; i++) {
                if (!done[i] && dist[i] < best) {
                    best = dist[i]
                    s = i
                }
            }
            if (s < 0) break
            done[s] = true
            let node = Math.idiv(s, 4)
            let d = s % 4
            let r = Math.idiv(node, COLS)
            let c = node % COLS
            if (r == gr && c == gc && (goalD < 0 || d == goalD)) {
                goal = s
                break
            }
            // หมุนอยู่กับที่ไปหันทิศที่มีเส้น
            for (let nd = 0; nd < 4; nd++) {
                if (nd == d || !hasBranch(r, c, nd)) continue
                let t = idx(r, c) * 4 + nd
                let cost = best + turnCost(r, c, d, nd)
                if (cost < dist[t]) {
                    dist[t] = cost
                    prev[t] = s
                }
            }
            // เดินตรงไปทางแยกถัดไป
            let nr = r + (d == S ? 1 : (d == N ? -1 : 0))
            let nc = c + (d == E ? 1 : (d == W ? -1 : 0))
            if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && !blocked[idx(nr, nc)]) {
                let t2 = idx(nr, nc) * 4 + d
                let cost2 = best + (d == N || d == S ? COST_V : COST_H)
                if (cost2 < dist[t2]) {
                    dist[t2] = cost2
                    prev[t2] = s
                }
            }
        }
        let path: number[] = []
        if (goal < 0) return path
        let s2 = goal
        while (s2 >= 0) {
            path.insertAt(0, s2)
            s2 = prev[s2]
        }
        return path
    }

    function noPath(): void {
        KrathokKidsBit.robotStop()
        music.playTone(262, music.beat(BeatFraction.Half))
        music.playTone(196, music.beat(BeatFraction.Whole))
        basic.showIcon(IconNames.No)
        status("NO PATH!")
    }

    function status(text: string): void {
        if (KrathokKidsBit.oledIsReady()) KrathokKidsBit.oledShowLine(text, 8)
    }

    function runJunctions(n: number): void {
        if (n > 0) KrathokKidsBit.lineToJunction(Kids_Junction.Center, n, lineSpeed, Kids_Then.Stop, turnSpeed)
    }

    // พาหุ่นไปทางแยก (gr, gc) แล้วหันไปทิศ goalD (-1 = ทิศไหนก็ได้)
    function travel(gr: number, gc: number, goalD: number): boolean {
        if (inStart) leaveStartBox()
        if (blocked[idx(gr, gc)]) {
            noPath()
            return false
        }
        let path = plan(curR, curC, curD, gr, gc, goalD)
        if (path.length == 0) {
            noPath()
            return false
        }
        // ถ้ายังอยู่บนเส้นสั้น ต้องนับทางแยกแรกเพิ่มอีกหนึ่ง
        let moves = pending ? 1 : 0
        pending = false
        for (let i = 1; i < path.length; i++) {
            let a = path[i - 1]
            let b = path[i]
            let na = Math.idiv(a, 4)
            let nb = Math.idiv(b, 4)
            if (na == nb) {
                runJunctions(moves)
                moves = 0
                let r = Math.idiv(na, COLS)
                let c = na % COLS
                let from = a % 4
                let to = b % 4
                let left = bestTurnLeft(r, c, from, to)
                let n = turnCalls(r, c, from, to, left)
                for (let k = 0; k < n; k++) {
                    KrathokKidsBit.lineTurn(left ? Kids_LeftRight.Left : Kids_LeftRight.Right, turnSpeed)
                }
            }
            else {
                moves++
            }
        }
        runJunctions(moves)
        let last = path[path.length - 1]
        curR = gr
        curC = gc
        curD = last % 4
        return true
    }

    // อ่านเซ็นเซอร์ทางแยก (ช่อง 6 และ 7 ตามการตั้งค่ามาตรฐาน) ว่าเห็นเส้นหรือไม่
    // คืน -1 ถ้ายังไม่ได้สอนเซ็นเซอร์
    function sideOnLine(): number {
        let found = 0
        for (let ch = 6; ch <= 7; ch++) {
            let on = KrathokKidsBit.getSensorCal(ch, Cal_Which.Line)
            let bg = KrathokKidsBit.getSensorCal(ch, Cal_Which.Ground)
            if (on == bg) return -1
            let v = pins.map(KrathokKidsBit.ADCRead(KrathokKidsBit.adcCmd(ch)), on, bg, 1000, 0)
            if (v >= 500) found = 1
        }
        return found
    }

    // วิ่งตรงจนเซ็นเซอร์ทางแยกเห็นเส้น (ขอบกรอบหรือขอบถัง) แล้วเบรก
    // ถ้าเริ่มบนเส้นอยู่แล้ว จะวิ่งให้พ้นเส้นเดิมก่อน
    // คืน false ถ้ายังไม่ได้สอนเซ็นเซอร์ (วิ่งตามเวลาแทน)
    function driveToEdge(): boolean {
        let t0 = input.runningTime()
        KrathokKidsBit.robotWheels(lineSpeed, lineSpeed)
        while (sideOnLine() == 1 && input.runningTime() - t0 < 500) basic.pause(2)
        let ok = true
        while (input.runningTime() - t0 < 2500) {
            let s = sideOnLine()
            if (s < 0) {
                ok = false
                basic.pause(400)
                break
            }
            if (s == 1) break
            basic.pause(2)
        }
        KrathokKidsBit.robotWheels(-100, -100)
        basic.pause(20)
        KrathokKidsBit.robotStop()
        return ok
    }

    // ออกจากกรอบ START: วิ่งตรงจนเจอขอบล่างของกรอบ
    // จากนั้นบล็อกเดินตามเส้นจะข้ามขอบกรอบเองเหมือนข้ามทางแยก
    function leaveStartBox(): void {
        inStart = false
        driveToEdge()
        curR = 0
        curC = MID
        curD = S
        pending = true
    }

    function doPick(): boolean {
        if (!travel(ROWS - 1, MID, S)) return false
        KrathokKidsBit.armDo(Kids_ArmAction.OpenGrip)
        let slow = Math.min(lineSpeed, 30)
        if (pickMode == Waste_PickMode.Ultrasonic) KrathokKidsBit.lineToObstacle(pickValue, slow)
        else if (pickValue > 0) KrathokKidsBit.lineFollowFor(pickValue, slow)
        KrathokKidsBit.robotStop()
        // ค่อยๆ หมุน กระป๋องในก้ามจะได้ไม่แกว่งหลุดมือตอนยก
        KrathokKidsBit.armDo(Kids_ArmAction.GripAndLift, true)
        KrathokKidsBit.lineTurn(Kids_LeftRight.Left, turnSpeed)
        curD = N
        pending = true
        return true
    }

    function doDrop(color: Waste_Color): boolean {
        let col = color == Waste_Color.Black ? blackCol : whiteCol
        if (!travel(0, col, N)) return false
        driveToEdge()                       // หยุดที่ขอบถัง
        if (binIn > 0) KrathokKidsBit.robotStraightFor(Kids_Direction.Forward, lineSpeed, binIn)
        KrathokKidsBit.robotStop()
        // ค่อยๆ หมุน กระป๋องจะได้ไม่กระแทกพื้นแล้วล้ม (กติกาหน้า 7 ข้อ 2 ล้มแล้วได้ 0 คะแนน)
        KrathokKidsBit.armDo(Kids_ArmAction.PlaceAndRelease, true)
        // ถอยจนเซ็นเซอร์พ้นพื้นที่ถัง (ถังดำเป็นสีดำทั้งแผ่น) แล้วถอยต่ออีกตามที่ตั้ง
        let t0 = input.runningTime()
        KrathokKidsBit.robotWheels(-lineSpeed, -lineSpeed)
        while (sideOnLine() == 1 && input.runningTime() - t0 < 1500) basic.pause(2)
        KrathokKidsBit.robotStop()
        if (binBack > 0) KrathokKidsBit.robotStraightFor(Kids_Direction.Backward, lineSpeed, binBack)
        KrathokKidsBit.lineTurn(Kids_LeftRight.Left, turnSpeed)
        curD = S
        pending = true
        return true
    }

    function doMoveCan(n: number): boolean {
        n = Math.max(1, Math.min(8, Math.round(n)))
        let color = canColors[n - 1]
        status("CAN " + n + "/8 " + (color == Waste_Color.Black ? "BLACK" : "WHITE"))
        if (!doPick()) return false
        return doDrop(color)
    }

    function doPark(): boolean {
        if (!travel(0, MID, N)) return false
        driveToEdge()                       // ขอบล่างของกรอบ START
        if (parkIn > 0) KrathokKidsBit.robotStraightFor(Kids_Direction.Forward, lineSpeed, parkIn)
        KrathokKidsBit.robotStop()
        inStart = true
        status("FINISH")
        basic.showIcon(IconNames.Yes)
        return true
    }

    // =====================================================
    // ตั้งค่าสนาม
    // =====================================================

    /**
     * บอกตำแหน่งสิ่งกีดขวางที่กรรมการสุ่มวาง (วางทับทางแยก) ใส่ให้ครบ 4 ชิ้น
     * หุ่นจะไม่วิ่งผ่านทางแยกนั้นและหาทางอ้อมให้เอง
     * @param row แถว 1-4 นับจากด้านบน (ใกล้ START)
     * @param col คอลัมน์ 1-5 นับจากซ้าย (ฝั่งถังดำ)
     */
    //% group="ตั้งค่าสนาม"
    //% weight=100
    //% block="มีสิ่งกีดขวางที่ แถว $row คอลัมน์ $col"
    export function setObstacle(row: Waste_Row, col: Waste_Col): void {
        blocked[idx(row, col)] = true
    }

    /**
     * ลบสิ่งกีดขวางทั้งหมดออกจากแผนที่
     */
    //% group="ตั้งค่าสนาม"
    //% weight=99
    //% block="ล้างสิ่งกีดขวางทั้งหมด"
    export function clearObstacles(): void {
        for (let i = 0; i < blocked.length; i++) blocked[i] = false
    }

    /**
     * ใส่ลำดับสีกระป๋อง 8 ใบที่กรรมการสุ่มได้
     */
    //% group="ตั้งค่าสนาม"
    //% weight=98
    //% block="ลำดับสีกระป๋อง|ใบที่ 1 $c1 ใบที่ 2 $c2 ใบที่ 3 $c3 ใบที่ 4 $c4|ใบที่ 5 $c5 ใบที่ 6 $c6 ใบที่ 7 $c7 ใบที่ 8 $c8"
    //% c2.defl=Waste_Color.Black c4.defl=Waste_Color.Black c6.defl=Waste_Color.Black c7.defl=Waste_Color.Black
    //% inlineInputMode=inline
    export function setCanColors(c1: Waste_Color, c2: Waste_Color, c3: Waste_Color, c4: Waste_Color,
        c5: Waste_Color, c6: Waste_Color, c7: Waste_Color, c8: Waste_Color): void {
        canColors = [c1, c2, c3, c4, c5, c6, c7, c8]
    }

    /**
     * ถังดำอยู่ด้านไหนของสนาม (มองจาก START ลงไปทางจุดวางกระป๋อง ด้านซ้ายของแผนที่คือคอลัมน์ 1)
     * ตามภาพในกติกา ถังดำอยู่ซ้าย ถังขาวอยู่ขวา
     */
    //% group="ตั้งค่าสนาม"
    //% weight=97
    //% block="ถังดำอยู่คอลัมน์ฝั่ง $side"
    export function setBlackBinSide(side: Waste_Side): void {
        blackCol = side == Waste_Side.Left ? 0 : COLS - 1
        whiteCol = COLS - 1 - blackCol
    }

    // =====================================================
    // ตั้งค่าหุ่น
    // =====================================================

    /**
     * ความเร็วที่ใช้ตลอดภารกิจ
     * @param speed ความเร็วตอนเดินตามเส้น
     * @param turn ความเร็วตอนเลี้ยวที่ทางแยก
     */
    //% group="ตั้งค่าหุ่น"
    //% weight=90
    //% block="ความเร็วเดินตามเส้น $speed ความเร็วเลี้ยว $turn"
    //% speed.min=10 speed.max=100 speed.defl=40
    //% turn.min=10 turn.max=100 turn.defl=50
    export function setSpeeds(speed: number, turn: number): void {
        lineSpeed = Math.max(10, Math.min(100, speed))
        turnSpeed = Math.max(10, Math.min(100, turn))
    }

    /**
     * วิธีเข้าไปหยิบกระป๋องที่จุดวางกระป๋อง
     * อัลตราโซนิก: เดินตามเส้นจนกระป๋องอยู่ใกล้กว่าค่าที่ตั้ง (ซม.) แล้วหยุด
     * จับเวลา: เดินตามเส้นจากทางแยกแถว 4 ตามเวลาที่ตั้ง (วินาที) แล้วหยุด
     */
    //% group="ตั้งค่าหุ่น"
    //% weight=89
    //% block="หยิบกระป๋องด้วย $mode $value"
    //% value.defl=6
    export function setPick(mode: Waste_PickMode, value: number): void {
        pickMode = mode
        pickValue = Math.max(0, value)
    }

    /**
     * ปรับระยะตอนวางกระป๋องลงถัง และตอนจอดในกรอบ START (หน่วยวินาที)
     * @param inSec พอถึงขอบถังแล้ว เดินตรงเข้าไปอีกกี่วินาทีก่อนวาง
     * @param backSec วางเสร็จแล้ว ถอยออกกี่วินาทีก่อนกลับหลังหัน
     * @param parkSec ถึงขอบกรอบ START แล้ว เดินเข้าไปอีกกี่วินาทีให้ทั้งตัวอยู่ในกรอบ
     */
    //% group="ตั้งค่าหุ่น"
    //% weight=88
    //% block="เข้าถังอีก $inSec วินาที ถอยออก $backSec วินาที เข้ากรอบ START อีก $parkSec วินาที"
    //% inSec.min=0 inSec.defl=0
    //% backSec.min=0 backSec.defl=0.3
    //% parkSec.min=0 parkSec.defl=0.5
    //% inlineInputMode=inline
    export function setDrop(inSec: number, backSec: number, parkSec: number): void {
        binIn = Math.max(0, inSec)
        binBack = Math.max(0, backSec)
        parkIn = Math.max(0, parkSec)
    }

    // =====================================================
    // ภารกิจ
    // =====================================================

    /**
     * ทำภารกิจทั้งหมด: ออกจาก START ย้ายกระป๋องครบ 8 ใบตามลำดับสี แล้วกลับไปจอดที่ START
     * ถ้าหาเส้นทางไม่ได้ หุ่นจะหยุด ส่งเสียง และแสดงรูปกากบาท
     */
    //% group="ภารกิจ"
    //% weight=80
    //% block="ทำภารกิจแยกขยะครบ 8 กระป๋อง แล้วกลับจุดเริ่มต้น"
    export function runMission(): void {
        for (let i = 1; i <= 8; i++) {
            if (!doMoveCan(i)) return
        }
        doPark()
    }

    /**
     * ย้ายกระป๋องใบที่เลือกหนึ่งใบ: ไปหยิบที่จุดวางกระป๋อง แล้วนำไปวางที่ถังตามสีของใบนั้น
     * @param n กระป๋องใบที่ 1-8
     */
    //% group="ภารกิจ"
    //% weight=79
    //% block="ย้ายกระป๋องใบที่ $n"
    //% n.min=1 n.max=8 n.defl=1
    export function moveCan(n: number): void {
        doMoveCan(n)
    }

    /**
     * กลับไปทางแยกหน้า START แล้วเดินเข้ากรอบ หยุดนิ่ง (กติกาให้หยุดนิ่งอย่างน้อย 3 วินาที)
     */
    //% group="ภารกิจ"
    //% weight=78
    //% block="กลับจุดเริ่มต้นแล้วจอด"
    export function parkAtStart(): void {
        doPark()
    }

    // =====================================================
    // ทีละขั้น
    // =====================================================

    /**
     * ไปที่จุดวางกระป๋อง หยิบกระป๋องขึ้น แล้วกลับหลังหันพร้อมออกเดินทาง
     */
    //% group="ทีละขั้น"
    //% weight=70
    //% block="ไปหยิบกระป๋องที่จุดวางกระป๋อง"
    export function pickCan(): void {
        doPick()
    }

    /**
     * ไปที่ถังสีที่เลือก วางกระป๋องลงในถัง ถอยออก แล้วกลับหลังหัน
     */
    //% group="ทีละขั้น"
    //% weight=69
    //% block="ไปวางกระป๋องที่ถังสี $color"
    export function dropCan(color: Waste_Color): void {
        doDrop(color)
    }

    /**
     * ไปหยุดที่ทางแยกที่เลือก โดยอ้อมสิ่งกีดขวางเอง ใช้ทดลองหรือทำภารกิจเซอร์ไพรส์
     */
    //% group="ทีละขั้น"
    //% weight=68
    //% block="ไปที่ทางแยก แถว $row คอลัมน์ $col"
    export function goToJunction(row: Waste_Row, col: Waste_Col): void {
        travel(row, col, -1)
    }

    // =====================================================
    // ตรวจสอบ
    // =====================================================

    /**
     * สีของกระป๋องใบที่เลือก (ตามที่ตั้งไว้ในบล็อก "ลำดับสีกระป๋อง")
     */
    //% group="ตรวจสอบ"
    //% weight=60
    //% block="สีกระป๋องใบที่ $n เป็น $color"
    //% n.min=1 n.max=8 n.defl=1
    export function canIs(n: number, color: Waste_Color): boolean {
        n = Math.max(1, Math.min(8, Math.round(n)))
        return canColors[n - 1] == color
    }

    /**
     * ตรวจว่าจากสิ่งกีดขวางที่ใส่ไว้ หุ่นไปได้ครบทุกที่หรือไม่
     * (START → จุดวางกระป๋อง → ถังดำ/ถังขาว → จุดวางกระป๋อง → START)
     */
    //% group="ตรวจสอบ"
    //% weight=59
    //% block="เส้นทางไปได้ครบทุกที่"
    export function routesOk(): boolean {
        let pr = ROWS - 1
        if (plan(0, MID, S, pr, MID, S).length == 0) return false
        let bins = [blackCol, whiteCol]
        for (let i = 0; i < 2; i++) {
            if (plan(pr, MID, N, 0, bins[i], N).length == 0) return false
            if (plan(0, bins[i], S, pr, MID, S).length == 0) return false
        }
        return plan(pr, MID, N, 0, MID, N).length > 0
    }

    /**
     * วาดแผนที่สนามบนจอ OLED: ทางแยก สิ่งกีดขวาง (X) ถัง และลำดับสีกระป๋อง
     * ใช้ตรวจว่าใส่ตำแหน่งสิ่งกีดขวางถูกต้องก่อนปล่อยหุ่น
     * ต้องใช้บล็อก "เริ่มใช้จอ OLED" ก่อน
     */
    //% group="ตรวจสอบ"
    //% weight=58
    //% block="แสดงแผนที่สนามบนจอ OLED"
    export function showMap(): void {
        if (!KrathokKidsBit.oledIsReady()) return
        KrathokKidsBit.oledSetAutoUpdate(false)
        KrathokKidsBit.oledClear()
        let x0 = 14
        let dx = 25
        let y0 = 16
        let dy = 10
        let xs = x0 + MID * dx
        let yb = y0 + (ROWS - 1) * dy
        // เส้นแนวนอนและแนวตั้ง
        for (let r = 0; r < ROWS; r++) {
            KrathokKidsBit.oledDrawLine(x0, y0 + r * dy, x0 + (COLS - 1) * dx, y0 + r * dy, OLED_Color.White)
        }
        for (let c = 0; c < COLS; c++) {
            KrathokKidsBit.oledDrawLine(x0 + c * dx, y0, x0 + c * dx, yb, OLED_Color.White)
        }
        // เส้นไปถัง START และจุดวางกระป๋อง
        KrathokKidsBit.oledDrawLine(x0 + blackCol * dx, 8, x0 + blackCol * dx, y0, OLED_Color.White)
        KrathokKidsBit.oledDrawLine(x0 + whiteCol * dx, 8, x0 + whiteCol * dx, y0, OLED_Color.White)
        KrathokKidsBit.oledDrawLine(xs, 8, xs, y0, OLED_Color.White)
        KrathokKidsBit.oledDrawLine(xs, yb, xs, yb + 5, OLED_Color.White)
        KrathokKidsBit.oledDrawCircle(xs, yb + 6, 2, OLED_Fill.Filled, OLED_Color.White)
        KrathokKidsBit.oledDrawRect(x0 + blackCol * dx - 4, 0, 9, 8, OLED_Fill.Filled, OLED_Color.White)
        KrathokKidsBit.oledDrawRect(x0 + whiteCol * dx - 4, 0, 9, 8, OLED_Fill.Outline, OLED_Color.White)
        KrathokKidsBit.oledShowString("S", xs - 2, 0, 1, OLED_Color.White)
        // สิ่งกีดขวาง: กล่องดำขอบขาวทับทางแยก
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (!blocked[idx(r, c)]) continue
                let x = x0 + c * dx
                let y = y0 + r * dy
                KrathokKidsBit.oledDrawRect(x - 8, y - 3, 17, 7, OLED_Fill.Filled, OLED_Color.Black)
                KrathokKidsBit.oledDrawRect(x - 8, y - 3, 17, 7, OLED_Fill.Outline, OLED_Color.White)
                KrathokKidsBit.oledDrawLine(x - 2, y - 2, x + 2, y + 2, OLED_Color.White)
                KrathokKidsBit.oledDrawLine(x - 2, y + 2, x + 2, y - 2, OLED_Color.White)
            }
        }
        // ลำดับสีกระป๋อง ใบที่ 1 อยู่ขวาสุด (ใกล้จุดวาง) แบบเดียวกับภาพในกติกา
        for (let i = 0; i < 8; i++) {
            let x = xs - 10 - i * 6
            let fill = canColors[i] == Waste_Color.Black ? OLED_Fill.Filled : OLED_Fill.Outline
            KrathokKidsBit.oledDrawCircle(x, 58, 2, fill, OLED_Color.White)
        }
        KrathokKidsBit.oledShowString(routesOk() ? "OK" : "NO", 100, 56, 1, OLED_Color.White)
        KrathokKidsBit.oledRefresh()
        KrathokKidsBit.oledSetAutoUpdate(true)
    }
}
