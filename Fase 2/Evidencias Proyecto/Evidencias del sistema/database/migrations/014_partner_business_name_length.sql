SET XACT_ABORT ON;
GO

IF EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE object_id = OBJECT_ID('vcm.SocioFormador')
    AND name = 'razon_social'
    AND max_length < 700
)
BEGIN
  ALTER TABLE vcm.SocioFormador
    ALTER COLUMN razon_social nvarchar(350) NOT NULL;
END;
GO
