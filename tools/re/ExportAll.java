// Post-analysis export: pseudo-C for every function, plus a string -> referencing-function index.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import ghidra.program.model.data.StringDataInstance;
import java.io.*;
import java.util.*;

public class ExportAll extends GhidraScript {
    @Override
    public void run() throws Exception {
        String outDir = getScriptArgs().length > 0 ? getScriptArgs()[0] : "/tmp";
        DecompInterface ifc = new DecompInterface();
        ifc.openProgram(currentProgram);
        int n = 0;
        try (PrintWriter c = new PrintWriter(new FileWriter(outDir + "/decompiled.c"));
             PrintWriter fl = new PrintWriter(new FileWriter(outDir + "/functions.tsv"))) {
            for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
                if (monitor.isCancelled()) break;
                fl.println(f.getEntryPoint() + "\t" + f.getName() + "\t" + f.getBody().getNumAddresses());
                DecompileResults r = ifc.decompileFunction(f, 60, monitor);
                c.println("// ==== " + f.getEntryPoint() + " " + f.getName());
                if (r != null && r.decompileCompleted()) c.println(r.getDecompiledFunction().getC());
                else c.println("// decompile failed");
                n++;
            }
        }
        try (PrintWriter s = new PrintWriter(new FileWriter(outDir + "/strings.tsv"))) {
            for (Data d : currentProgram.getListing().getDefinedData(true)) {
                StringDataInstance sdi = StringDataInstance.getStringDataInstance(d);
                if (sdi == StringDataInstance.NULL_INSTANCE) continue;
                String str = sdi.getStringValue();
                if (str == null) continue;
                Set<String> users = new TreeSet<>();
                for (Reference ref : getReferencesTo(d.getAddress())) {
                    Function f = getFunctionContaining(ref.getFromAddress());
                    users.add(f != null ? f.getEntryPoint() + ":" + f.getName() : ref.getFromAddress().toString());
                    // literal-pool pointer: follow one more hop
                    for (Reference r2 : getReferencesTo(ref.getFromAddress())) {
                        Function f2 = getFunctionContaining(r2.getFromAddress());
                        if (f2 != null) users.add(f2.getEntryPoint() + ":" + f2.getName());
                    }
                }
                s.println(d.getAddress() + "\t" + String.join(",", users) + "\t" + str.replace("\n", "\\n").replace("\t", "\\t"));
            }
        }
        println("exported functions: " + n);
    }
}
