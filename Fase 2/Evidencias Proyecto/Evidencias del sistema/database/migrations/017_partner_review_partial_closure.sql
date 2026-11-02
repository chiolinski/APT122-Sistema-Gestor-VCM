-- Cierre interno de la revision del socio; NO cierra ni reabre Hito 2.
SET XACT_ABORT ON;
GO
IF OBJECT_ID('vcm.RevisionSocio', 'U') IS NULL
  THROW 52700, 'Primero debe aplicarse 015_partner_reviews.sql.', 1;
GO
IF COL_LENGTH('vcm.RevisionSocio', 'cierre_interno') IS NULL
  ALTER TABLE vcm.RevisionSocio ADD cierre_interno bit NOT NULL
    CONSTRAINT DF_RevisionSocio_CierreInterno DEFAULT 0 WITH VALUES;
GO
IF COL_LENGTH('vcm.RevisionSocio', 'cerrado_por_usuario_id') IS NULL
  ALTER TABLE vcm.RevisionSocio ADD cerrado_por_usuario_id uniqueidentifier NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_RevisionSocio_CerradoPor')
  ALTER TABLE vcm.RevisionSocio WITH CHECK ADD CONSTRAINT FK_RevisionSocio_CerradoPor
    FOREIGN KEY (cerrado_por_usuario_id) REFERENCES vcm.Usuario(usuario_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_RevisionSocio_CierreInterno')
  ALTER TABLE vcm.RevisionSocio WITH CHECK ADD CONSTRAINT CK_RevisionSocio_CierreInterno CHECK (
    (cierre_interno = 0 AND cerrado_por_usuario_id IS NULL)
    OR (cierre_interno = 1 AND cerrado_por_usuario_id IS NOT NULL AND completado_en IS NOT NULL)
  );
GO
-- Limita tambien enlaces pendientes ya emitidos, desde su fecha original.
-- No extiende enlaces mas cortos ni convierte el vencimiento en un cierre.
UPDATE vcm.RevisionSocio
SET vence_en = DATEADD(day, 21, creado_en)
WHERE revocado_en IS NULL AND completado_en IS NULL
  AND vence_en > DATEADD(day, 21, creado_en);
GO
