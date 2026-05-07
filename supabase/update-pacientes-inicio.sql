-- Update mes_inicio/anio_inicio/mes_alta/anio_alta/estatus/precio para pacientes
-- Datos del archivo Book1.csv del usuario (63 pacientes)

BEGIN;

-- Adrian Quintana
UPDATE public.paciente SET mes_inicio = 3, anio_inicio = 2025, mes_alta = 4, anio_alta = 2026, estatus = 'Inactivo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b02';

-- Alan Leonardo
UPDATE public.paciente SET mes_inicio = 8, anio_inicio = 2024, mes_alta = 4, anio_alta = 2026, estatus = 'Inactivo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b03';

-- Alana Hdz Lagarda
UPDATE public.paciente SET mes_inicio = 9, anio_inicio = 2023, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b04';

-- Alejandro Assad
UPDATE public.paciente SET mes_inicio = 3, anio_inicio = 2025, mes_alta = 4, anio_alta = 2026, estatus = 'Inactivo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b05';

-- Alison Muñiz
UPDATE public.paciente SET mes_inicio = 11, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 900.0 WHERE id = '69ed0140ddad188217628b06';

-- Ana Sofia Lopez Pérez
UPDATE public.paciente SET mes_inicio = 10, anio_inicio = 2021, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b07';

-- Andres Gomez Escamilla
UPDATE public.paciente SET mes_inicio = 4, anio_inicio = 2024, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b08';

-- Benjamin Rueda
UPDATE public.paciente SET mes_inicio = 8, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b09';

-- Camila Garcia
UPDATE public.paciente SET mes_inicio = 8, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b0a';

-- Camila Soto
UPDATE public.paciente SET mes_inicio = 6, anio_inicio = 2024, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b0b';

-- Carlos Valenzuela
UPDATE public.paciente SET mes_inicio = 11, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b0c';

-- Carola Martinez
UPDATE public.paciente SET mes_inicio = 8, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed1ac103a98478af377734';

-- Catalina Hinojosa
UPDATE public.paciente SET mes_inicio = 2, anio_inicio = 2026, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b0e';

-- Cordelia Hinojosa
UPDATE public.paciente SET mes_inicio = 9, anio_inicio = 2024, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b0f';

-- Daniela Gallegos
UPDATE public.paciente SET mes_inicio = 11, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 900.0 WHERE id = '69ed0140ddad188217628b10';

-- David Marcos Cruz
UPDATE public.paciente SET mes_inicio = 2, anio_inicio = 2026, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b11';

-- Diego Cruz González
UPDATE public.paciente SET mes_inicio = 7, anio_inicio = 2022, mes_alta = 2, anio_alta = 2026, estatus = 'Inactivo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b12';

-- Diego Muñoz
UPDATE public.paciente SET mes_inicio = 8, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b13';

-- Diego Zuviri
UPDATE public.paciente SET mes_inicio = 3, anio_inicio = 2026, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed1ac103a98478af37776c';

-- Donato Saldivar Garza
UPDATE public.paciente SET estatus = 'Inactivo' WHERE id = '69ed0140ddad188217628b14';

-- Eduardo Hdz Bovio
UPDATE public.paciente SET mes_inicio = 11, anio_inicio = 2023, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b15';

-- Elias Marcelo
UPDATE public.paciente SET estatus = 'Inactivo' WHERE id = '69ed1ac103a98478af37773d';

-- Elias Marcelo Leal
UPDATE public.paciente SET mes_inicio = 1, anio_inicio = 2025, mes_alta = 3, anio_alta = 2026, estatus = 'Inactivo', precio_sesion_regular = 500.0 WHERE id = '69ed0140ddad188217628b16';

-- Elias Ramos
UPDATE public.paciente SET mes_inicio = 11, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 900.0 WHERE id = '69ed0140ddad188217628b17';

-- Emilia Vazquez
UPDATE public.paciente SET mes_inicio = 1, anio_inicio = 2026, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b18';

-- Emiliano Torres
UPDATE public.paciente SET mes_inicio = 5, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 350.0 WHERE id = '69ed0140ddad188217628b19';

-- Emilio Benavides
UPDATE public.paciente SET mes_inicio = 3, anio_inicio = 2026, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b1a';

-- Emilio Buerba
UPDATE public.paciente SET mes_inicio = 11, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b1b';

-- Eugenia Arredondo
UPDATE public.paciente SET mes_inicio = 10, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b1c';

-- Eugenio Gonzalez
UPDATE public.paciente SET estatus = 'Inactivo' WHERE id = '69ed0140ddad188217628b1d';

-- Eva Lozano
UPDATE public.paciente SET mes_inicio = 8, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b1e';

-- Federico Garza
UPDATE public.paciente SET mes_inicio = 9, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 333.33 WHERE id = '69ed0140ddad188217628b1f';

-- Fernando Treviño
UPDATE public.paciente SET mes_inicio = 3, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b21';

-- Frida Olvera
UPDATE public.paciente SET mes_inicio = 4, anio_inicio = 2026, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b22';

-- Gerardo Romero Quintanilla
UPDATE public.paciente SET mes_inicio = 7, anio_inicio = 2022, mes_alta = 4, anio_alta = 2026, estatus = 'Inactivo', precio_sesion_regular = 1100.0 WHERE id = '69ed1ac103a98478af37774a';

-- Ian Cornish Ravizé
UPDATE public.paciente SET mes_inicio = 8, anio_inicio = 2023, mes_alta = 4, anio_alta = 2026, estatus = 'Inactivo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b24';

-- James Anthony
UPDATE public.paciente SET mes_inicio = 3, anio_inicio = 2026, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b25';

-- Jimena Mendivil Torres
UPDATE public.paciente SET mes_inicio = 10, anio_inicio = 2021, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b26';

-- Joaquin Nuñez
UPDATE public.paciente SET mes_inicio = 10, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b27';

-- José Antonio Lobeira
UPDATE public.paciente SET mes_inicio = 4, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b28';

-- Julieta Gonzalez
UPDATE public.paciente SET mes_inicio = 2, anio_inicio = 2026, mes_alta = 3, anio_alta = 2026, estatus = 'Inactivo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b2a';

-- Leonardo Rizzi
UPDATE public.paciente SET mes_inicio = 4, anio_inicio = 2026, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b2b';

-- Leonel Pineda
UPDATE public.paciente SET mes_inicio = 3, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b2c';

-- Lukey Immendorf
UPDATE public.paciente SET mes_inicio = 12, anio_inicio = 2024, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b2d';

-- Marcelo Hermosillo
UPDATE public.paciente SET mes_inicio = 3, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b2f';

-- María Carlota Castillo
UPDATE public.paciente SET mes_inicio = 12, anio_inicio = 2024, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b31';

-- María Fernanda Vázquez
UPDATE public.paciente SET mes_inicio = 3, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b32';

-- Maria José González
UPDATE public.paciente SET mes_inicio = 8, anio_inicio = 2024, mes_alta = 4, anio_alta = 2026, estatus = 'Inactivo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b30';

-- Mateo Gamez
UPDATE public.paciente SET mes_inicio = 2, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b33';

-- Mathias Orozco
UPDATE public.paciente SET mes_inicio = 6, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 400.0 WHERE id = '69ed0140ddad188217628b34';

-- Maximo Garcia
UPDATE public.paciente SET mes_inicio = 2, anio_inicio = 2026, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b36';

-- Nathan Herrera Dávila
UPDATE public.paciente SET mes_inicio = 1, anio_inicio = 2026, mes_alta = 4, anio_alta = 2026, estatus = 'Inactivo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b38';

-- Oliver Alexander
UPDATE public.paciente SET mes_inicio = 2, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b39';

-- Pato Rdz Hernandez
UPDATE public.paciente SET mes_inicio = 1, anio_inicio = 2022, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b3a';

-- Pedro Gloria Kuljacha
UPDATE public.paciente SET mes_inicio = 2, anio_inicio = 2024, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b3b';

-- Pedro Gonzalez
UPDATE public.paciente SET mes_inicio = 9, anio_inicio = 2024, estatus = 'Activo', precio_sesion_regular = 475.0 WHERE id = '69ed0140ddad188217628b3c';

-- Regina Garza
UPDATE public.paciente SET mes_inicio = 6, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b3d';

-- Ricardo Estrada
UPDATE public.paciente SET mes_inicio = 11, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b3e';

-- Ricardo Martin
UPDATE public.paciente SET mes_inicio = 7, anio_inicio = 2025, mes_alta = 5, anio_alta = 2026, estatus = 'Inactivo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b3f';

-- Rodrigo Berlanga
UPDATE public.paciente SET mes_inicio = 4, anio_inicio = 2026, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b40';

-- Santiago Espinoza
UPDATE public.paciente SET mes_inicio = 10, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b41';

-- Santiago Lopez Siañez
UPDATE public.paciente SET mes_inicio = 7, anio_inicio = 2023, estatus = 'Activo', precio_sesion_regular = 900.0 WHERE id = '69ed0140ddad188217628b42';

-- Sebastian Cruz
UPDATE public.paciente SET mes_inicio = 9, anio_inicio = 2025, estatus = 'Activo', precio_sesion_regular = 550.0 WHERE id = '69ed0140ddad188217628b43';

-- Victor Tovar
UPDATE public.paciente SET mes_inicio = 1, anio_inicio = 2026, estatus = 'Activo', precio_sesion_regular = 1100.0 WHERE id = '69ed0140ddad188217628b44';

COMMIT;
