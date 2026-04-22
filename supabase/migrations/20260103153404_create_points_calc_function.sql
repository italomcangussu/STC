CREATE OR REPLACE FUNCTION get_active_user_points()
RETURNS TABLE (
    user_id UUID,
    total_points BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ph.user_id,
        COALESCE(SUM(ph.amount), 0) as total_points
    FROM 
        point_history ph
    WHERE 
        ph.status = 'active' 
        AND ph.expires_at > CURRENT_DATE
    GROUP BY 
        ph.user_id;
END;
$$ LANGUAGE plpgsql;

-- Grant access
GRANT EXECUTE ON FUNCTION get_active_user_points() TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_user_points() TO anon;
;
