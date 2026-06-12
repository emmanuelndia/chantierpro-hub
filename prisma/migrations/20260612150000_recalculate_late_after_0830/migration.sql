UPDATE "ClockInRecord"
SET "isLate" = CASE
  WHEN "type" = 'ARRIVAL' AND "clockInTime" > TIME '08:30:00' THEN TRUE
  ELSE FALSE
END;
