-- BF-216B: one narrowly authorized, side-effect-free historical projection.
CREATE FUNCTION public.get_purchase_detail(p_business_id uuid, p_purchase_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target public.purchases%ROWTYPE;
  audit private.purchase_voids%ROWTYPE;
  result_items jsonb;
  result_expense jsonb;
  void_info jsonb := '{"status":"not_applicable"}'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_business_role(p_business_id, ARRAY['OWNER']) THEN
    RAISE EXCEPTION 'Purchase access denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO target FROM public.purchases p WHERE p.id=p_purchase_id AND p.business_id=p_business_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'product_name_snapshot',i.product_name_snapshot,'quantity',i.quantity,
    'unit_cost_snapshot',i.unit_cost_snapshot,'line_total',i.line_total) ORDER BY i.id),'[]'::jsonb)
    INTO result_items FROM public.purchase_items i WHERE i.purchase_id=target.id;
  SELECT jsonb_build_object('amount',e.amount,'expense_date',e.expense_date,
    'payment_method',e.payment_method,'category_name',c.name)
    INTO result_expense FROM public.expenses e
    LEFT JOIN public.expense_categories c ON c.id=e.category_id AND c.business_id=e.business_id
    WHERE e.purchase_id=target.id AND e.business_id=p_business_id AND e.source_type='PURCHASE';

  IF target.status='VOIDED' THEN
    void_info := '{"status":"unavailable"}'::jsonb;
    SELECT * INTO audit FROM private.purchase_voids a
      WHERE a.purchase_id=target.id AND a.business_id=p_business_id;
    -- EXCEPT ALL verifies multiplicity. No positional join or invented item FK.
    IF FOUND AND jsonb_array_length(result_items)>0
      AND NOT EXISTS (SELECT 1 FROM public.stock_movements m
        WHERE m.reference_type='PURCHASE_VOID' AND m.reference_id=audit.id
          AND (m.business_id<>p_business_id OR m.type<>'ADJUSTMENT'
            OR m.created_by<>audit.created_by OR m.created_at<>audit.created_at
            OR m.occurred_at<>audit.created_at OR m.notes IS NOT NULL))
      AND NOT EXISTS (
        (SELECT i.product_id,-i.quantity,i.unit_cost_snapshot FROM public.purchase_items i WHERE i.purchase_id=target.id
         EXCEPT ALL
         SELECT m.product_id,m.quantity_delta,m.unit_cost FROM public.stock_movements m
           WHERE m.reference_type='PURCHASE_VOID' AND m.reference_id=audit.id)
        UNION ALL
        (SELECT m.product_id,m.quantity_delta,m.unit_cost FROM public.stock_movements m
           WHERE m.reference_type='PURCHASE_VOID' AND m.reference_id=audit.id
         EXCEPT ALL
         SELECT i.product_id,-i.quantity,i.unit_cost_snapshot FROM public.purchase_items i WHERE i.purchase_id=target.id)
      ) THEN
      SELECT jsonb_build_object('status','available','reason',audit.reason,'created_at',audit.created_at,
        'stockCompensation',jsonb_agg(jsonb_build_object('purchase_item_id',i.id,'quantity_delta',-i.quantity) ORDER BY i.id))
        INTO void_info FROM public.purchase_items i WHERE i.purchase_id=target.id;
    END IF;
  END IF;
  RETURN jsonb_build_object('purchase',jsonb_build_object('id',target.id,'supplier',target.supplier,
    'total',target.total,'purchased_at',target.purchased_at,'status',target.status,'notes',target.notes),
    'items',result_items,'expense',result_expense,'voidInfo',void_info);
END $$;
REVOKE ALL ON FUNCTION public.get_purchase_detail(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_purchase_detail(uuid,uuid) TO authenticated;
