// Export pseudo-C for functions whose entry lies in [start, end).
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import java.io.*;

public class ExportRange extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] a = getScriptArgs();
        long start = Long.parseLong(a[0], 16), end = Long.parseLong(a[1], 16);
        DecompInterface ifc = new DecompInterface();
        ifc.openProgram(currentProgram);
        try (PrintWriter c = new PrintWriter(new FileWriter(a[2]))) {
            for (Function f : currentProgram.getFunctionManager().getFunctions(toAddr(start), true)) {
                if (f.getEntryPoint().getOffset() >= end) break;
                DecompileResults r = ifc.decompileFunction(f, 120, monitor);
                c.println("// ==== " + f.getEntryPoint() + " " + f.getName());
                c.println(r != null && r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// decompile failed");
            }
        }
    }
}
