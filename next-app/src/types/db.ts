// =============================================================================
// Tipos TypeScript de las entidades de Supabase.
// Espejo del schema en supabase/schema.sql. Los nombres de tabla en Postgres
// están en snake_case; los campos también. Aquí se mantiene el mismo formato
// para que `from('paciente').select('*')` devuelva un objeto bien tipado.
// =============================================================================

// ---------- Enums compartidos -------------------------------------------------

export type FormaPago = "Efectivo" | "Transferencia" | "Tarjeta" | "Depósito";

export type EstatusPaciente = "Activo" | "Inactivo" | "Pausado";

export type EstatusEmpleado = "Activo" | "Inactivo";

export type TipoEvento =
  | "Cita inicial / ingreso"
  | "Cita seguimiento directora"
  | "Cita escolar virtual"
  | "Cita escolar presencial"
  | "Observación escolar"
  | "Reporte adicional"
  | "Evaluación";

export type CategoriaGasto =
  | "Renta"
  | "Materiales Centro"
  | "Materiales Limpieza"
  | "Comidas"
  | "Servicios"
  | "Renta Terapeutas"
  | "Capacitaciones"
  | "Nómina"
  | "Impuestos"
  | "Otros";

export type TipoParametro = "numero" | "porcentaje" | "dinero" | "texto";

export type AppRole = "admin" | "user" | "cap_terapias" | "cap_pagos" | "cap_gastos";

export type DiaSemana = "lunes" | "martes" | "miercoles" | "jueves" | "viernes" | "sabado" | "domingo";

// jsonb {dia: valor} con shape de 7 días
export type HorarioSemanal = Partial<Record<DiaSemana, string>>;

// jsonb {dia: 'Regular' | 'Matutina'}
export type TipoSesionSemanal = Partial<Record<DiaSemana, "Regular" | "Matutina">>;

export interface Reposicion {
  dia: number;
  hora: string;
  tipoRep: "Regular" | "Matutina";
}

// ---------- Campos comunes ----------------------------------------------------

interface Timestamps {
  created_date: string;
  updated_date: string;
}

// ---------- Entidades ---------------------------------------------------------

export interface Paciente extends Timestamps {
  id: string;
  nombre: string;
  forma_pago_default: FormaPago | null;
  precio_sesion_regular: number | null;
  precio_sesion_matutina: number | null;
  mes_inicio: number | null;
  anio_inicio: number | null;
  mes_alta: number | null;
  anio_alta: number | null;
  tipo_terapia: string | null;
  terapeutas: HorarioSemanal;
  dias_sesion: HorarioSemanal;
  tipo_sesion: TipoSesionSemanal;
  estatus: EstatusPaciente;
  notas: string | null;
}

export interface Empleado extends Timestamps {
  id: string;
  nombre: string;
  iniciales: string | null;
  puesto: string | null;
  sueldo_transferencia_mes: number;
  sueldo_efectivo_mes: number;
  fecha_ingreso: string | null;
  estatus: EstatusEmpleado;
  notas: string | null;
}

export interface CalendarioPaciente extends Timestamps {
  id: string;
  paciente_id: string;
  paciente_nombre: string | null;
  anio: number;
  mes: number;
  horario: HorarioSemanal;
  tipo_sesion: TipoSesionSemanal;
  terapeutas: HorarioSemanal;
  excepciones: string | null;
  reposiciones: Reposicion[];
  total_sesiones: number;
  sesiones_regulares: number;
  sesiones_matutinas: number;
  reposiciones_count: number;
  monto_efectivo: number;
  monto_transferencia: number;
  monto_override: number | null;
  notas: string | null;
}

export interface SesionMensual extends Timestamps {
  id: string;
  paciente_id: string;
  paciente_nombre: string | null;
  anio: number;
  mes: number;
  sesiones_matutinas: number;
  sesiones_regulares: number;
  beca_porcentaje: number;
  forma_pago_mes: FormaPago;
  excepciones_dias: string | null;
  monto_override: number | null;
  notas: string | null;
  capturado_por: string | null;
}

export interface PagoTerapia extends Timestamps {
  id: string;
  paciente_id: string;
  paciente_nombre: string | null;
  anio: number;
  mes: number;
  fecha_pago: string;
  dia_pago: number | null;
  monto_pagado: number;
  sesiones_manual: number | null;
  forma_pago: FormaPago;
  recargo: boolean;
  notas: string | null;
  capturado_por: string | null;
}

export interface Evento extends Timestamps {
  id: string;
  fecha: string;
  tipo: TipoEvento;
  nombre_paciente: string;
  forma_pago: FormaPago;
  precio_base: number | null;
  fecha_pago: string | null;
  monto_pagado: number;
  notas: string | null;
  capturado_por: string | null;
}

export interface Gasto extends Timestamps {
  id: string;
  fecha: string;
  categoria: CategoriaGasto;
  concepto: string;
  monto: number;
  con_factura: boolean;
  forma_pago: FormaPago;
  proveedor: string | null;
  notas: string | null;
  capturado_por: string | null;
}

export interface HorarioTerapeuta extends Timestamps {
  id: string;
  empleado_id: string;
  empleado_nombre: string | null;
  semana_inicio: string;
  slots: Record<string, string>;
}

export interface NominaMensual extends Timestamps {
  id: string;
  empleado_id: string;
  empleado_nombre: string | null;
  anio: number;
  mes: number;
  sueldo_transferencia: number;
  sueldo_efectivo: number;
  aguinaldo: number;
  vacaciones: number;
  bono: number;
  notas: string | null;
}

export interface Subarrendamiento extends Timestamps {
  id: string;
  inquilino: string;
  forma_pago: FormaPago;
  renta_mensual_base: number;
  anio: number;
  mes: number;
  monto_cobrado: number;
  notas: string | null;
}

export interface ResumenIngreso extends Timestamps {
  id: string;
  anio: number;
  mes: number;
  terapias: number;
  citas: number;
  evaluaciones: number;
  subarrendamiento: number;
  otros: number;
  notas: string | null;
}

export interface Parametro extends Timestamps {
  id: string;
  clave: string;
  valor: string;
  descripcion: string | null;
  tipo: TipoParametro;
}

export interface Profile extends Timestamps {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
}

// ---------- Mapa nombre_tabla → tipo de fila ---------------------------------

export interface TableMap {
  paciente: Paciente;
  empleado: Empleado;
  calendario_paciente: CalendarioPaciente;
  sesion_mensual: SesionMensual;
  pago_terapia: PagoTerapia;
  evento: Evento;
  gasto: Gasto;
  horario_terapeuta: HorarioTerapeuta;
  nomina_mensual: NominaMensual;
  subarrendamiento: Subarrendamiento;
  resumen_ingreso: ResumenIngreso;
  parametro: Parametro;
  profile: Profile;
}

export type TableName = keyof TableMap;
