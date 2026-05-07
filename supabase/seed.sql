-- =============================================================================
-- Flujo Consentido — Seed inicial
-- Solo siembra Parametros default. Las entidades transaccionales (Paciente,
-- PagoTerapia, etc.) se importan desde el dump de Base44 con un script aparte.
--
-- Todos los upserts son idempotentes: ON CONFLICT (clave) DO NOTHING para no
-- pisar valores que el admin haya ajustado desde la UI de Parametros.
-- =============================================================================

INSERT INTO public.parametro (clave, valor, descripcion, tipo) VALUES
  -- Año actual para reportes y filtros (D6)
  -- La app lo lee desde aquí; fallback a new Date().getFullYear() si está NULL.
  ('anio_actual',                 '2026',     'Año actual usado por dashboards y filtros mensuales',           'numero'),

  -- Precios base de terapia
  ('precio_terapia_regular',      '1100',     'Precio base por sesión regular (sin IVA)',                       'dinero'),
  ('precio_terapia_matutina',     '900',      'Precio base por sesión matutina (sin IVA)',                      'dinero'),

  -- Precios de citas y evaluaciones (autocompletado en CitasEvaluaciones)
  ('precio_cita_inicial',         '1500',     'Precio para Cita inicial / ingreso',                             'dinero'),
  ('precio_cita_seguimiento',     '1200',     'Precio para Cita seguimiento directora',                         'dinero'),
  ('precio_cita_escolar_virtual', '1500',     'Precio para Cita escolar virtual',                               'dinero'),
  ('precio_cita_escolar_presencial','2500',   'Precio para Cita escolar presencial',                            'dinero'),
  ('precio_observacion_escolar',  '2500',     'Precio para Observación escolar',                                'dinero'),
  ('precio_reporte_adicional',    '800',      'Precio para Reporte adicional',                                  'dinero'),
  ('precio_evaluacion',           '5000',     'Precio para Evaluación',                                         'dinero'),

  -- Tasas / reglas
  ('iva',                         '0.16',     'Tasa de IVA aplicada cuando forma_pago != Efectivo',             'porcentaje'),
  ('dia_tope_pago',               '10',       'Día del mes a partir del cual aplica recargo del 10%',           'numero'),
  ('recargo_porcentaje',          '0.10',     'Recargo aplicado a pagos posteriores a dia_tope_pago',           'porcentaje'),

  -- Impuestos / nómina (Nuevo León)
  ('imss_patronal',               '0.2575',   'Cuota patronal IMSS aproximada (factor sobre nómina)',           'porcentaje'),
  ('isn_nl',                      '0.03',     'Impuesto sobre nómina Nuevo León (3%)',                          'porcentaje'),
  ('isr_retenido_empleados',      '0.10',     'Factor de ISR retenido empleados (estimado)',                    'porcentaje'),
  ('factor_bruto_neto',           '1.30',     'Factor multiplicador para inflar neto a bruto en cálculos',      'porcentaje'),

  -- Caja
  ('saldo_inicial_caja',          '100000',   'Saldo inicial de caja al arrancar el año fiscal',                'dinero'),

  -- Branding / contacto
  ('email_contacto',              'contacto@flujoconsentido.com', 'Email mostrado en footer del PDF',           'texto'),
  ('nombre_clinica',              'Flujo Consentido',             'Nombre que aparece en headers de reportes',  'texto')
ON CONFLICT (clave) DO NOTHING;

-- =============================================================================
-- FIN
-- =============================================================================
