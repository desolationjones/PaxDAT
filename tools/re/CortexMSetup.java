// Pre-analysis setup for a raw STM32H7 (Cortex-M7) application image.
// - adds DTCM/AXI SRAM/SRAM1-4/peripheral/system blocks so absolute addresses resolve
// - walks the vector table, creating Thumb functions for each handler
// - turns on the aggressive instruction finder
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.mem.*;
import ghidra.program.model.lang.*;
import ghidra.program.model.symbol.SourceType;
import java.math.BigInteger;

public class CortexMSetup extends GhidraScript {
    MemoryBlock block(String name, long start, long len, boolean vol) throws Exception {
        Memory mem = currentProgram.getMemory();
        Address a = toAddr(start);
        if (mem.getBlock(a) != null) return mem.getBlock(a);
        MemoryBlock b = mem.createUninitializedBlock(name, a, len, false);
        b.setRead(true); b.setWrite(true); b.setExecute(false); b.setVolatile(vol);
        return b;
    }

    @Override
    public void run() throws Exception {
        // STM32H7 memory map (the Hapax app runs on an H7; see docs/FIRMWARE_NOTES.md)
        block("DTCM", 0x20000000L, 0x20000L, false);
        block("AXI_SRAM", 0x24000000L, 0x80000L, false);
        block("SRAM123", 0x30000000L, 0x48000L, false);
        block("SRAM4", 0x38000000L, 0x10000L, false);
        block("BKPSRAM", 0x38800000L, 0x1000L, false);
        block("PERIPH_APB_AHB", 0x40000000L, 0x20000000L, true);   // D1/D2/D3 peripherals 0x4000_0000-0x5FFF_FFFF
        block("SCS", 0xE0000000L, 0x100000L, true);

        MemoryBlock flash = currentProgram.getMemory().getBlock(toAddr(0x08020000L));
        long flashEnd = flash.getEnd().getOffset();
        Register tmode = currentProgram.getRegister("TMode");
        currentProgram.getProgramContext().setValue(tmode, flash.getStart(), flash.getEnd(), BigInteger.ONE);

        Address vt = toAddr(0x08020000L);
        int made = 0;
        for (int i = 0; i < 256; i++) {
            Address slot = vt.add(i * 4L);
            long v = getInt(slot) & 0xffffffffL;
            boolean code = (v & 1) == 1 && v >= 0x08020000L && v <= flashEnd;
            if (i > 0 && v != 0 && !code) { println("vector table ends at entry " + i); break; }
            try { createDWord(slot); } catch (Exception e) { }
            if (i == 0) { createLabel(slot, "vt_initial_sp", true); continue; }
            if (!code) continue;
            Address f = toAddr(v & ~1L);
            String name = i == 1 ? "Reset_Handler" : (i < 16 ? "Exception_" + i : "IRQ_" + (i - 16));
            if (getFunctionAt(f) == null) {
                currentProgram.getSymbolTable().createLabel(f, name, SourceType.USER_DEFINED);
                disassemble(f);
                createFunction(f, null);
                made++;
            }
        }
        println("vector handlers created: " + made);
        setAnalysisOption(currentProgram, "ARM Aggressive Instruction Finder", "true");
    }
}
