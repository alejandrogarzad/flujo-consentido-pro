"use client";

import { useState } from "react";
import { Download, Loader2, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { generarExcelRespaldo } from "@/lib/exportExcel";

export default function RespaldoPage() {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [generando, setGenerando] = useState(false);

  const descargar = async () => {
    setGenerando(true);
    try {
      const blob = await generarExcelRespaldo(anio);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flujo-consentido-respaldo-${anio}-${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Excel generado");
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Error al generar el respaldo");
    } finally {
      setGenerando(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-violet-100 flex items-center justify-center">
          <FileSpreadsheet size={24} className="text-violet-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-stone-800">Respaldo / Exportar</h1>
          <p className="text-sm text-stone-500">Descarga un Excel completo con todas las pestañas y fórmulas vivas</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-6">
        <label className="block text-sm font-medium text-stone-700 mb-2">Año</label>
        <input
          type="number"
          value={anio}
          onChange={(e) => setAnio(Number(e.target.value))}
          min={2020}
          max={2030}
          className="w-32 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 mb-4"
        />

        <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 mb-4 text-sm text-stone-700">
          <p className="font-semibold mb-2">El archivo incluirá las siguientes pestañas:</p>
          <ul className="space-y-1 text-xs text-stone-600">
            <li>• <strong>Parámetros</strong> — IVA, tasas, precios globales (editables, todo recalcula)</li>
            <li>• <strong>Tablas</strong> — LISR Art. 96 y LFT vacaciones (referencias)</li>
            <li>• <strong>Pacientes</strong> y <strong>Empleados</strong> — catálogos editables</li>
            <li>• <strong>Terapias</strong> — sesiones × precio = saldo, con fórmulas vivas</li>
            <li>• <strong>Citas</strong> y <strong>Evaluaciones</strong> — eventos con IVA automático</li>
            <li>• <strong>Subarrendamiento</strong>, <strong>Gastos</strong> — con IVA desglosado</li>
            <li>• <strong>Nómina</strong> — sueldos editables, prima vac, IMSS, ISN, ISR Ret., Infonavit</li>
            <li>• <strong>Flujo de Efectivo</strong> — SUMIF mensual + saldo acumulado</li>
            <li>• <strong>Para el Contador</strong> — resumen SAT mensual (facturable/efectivo)</li>
          </ul>
          <p className="mt-3 text-xs text-stone-500">
            <strong>Importante:</strong> los cambios en el Excel NO afectan la app. Para que reflejen,
            captura desde la web. Este archivo es un respaldo y herramienta de análisis fuera-de-línea.
          </p>
        </div>

        <button
          onClick={descargar}
          disabled={generando}
          className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white text-sm font-semibold px-6 py-3 rounded-xl transition-colors"
        >
          {generando ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Generando archivo Excel...
            </>
          ) : (
            <>
              <Download size={16} />
              Descargar Excel {anio}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
