export function ProductBrand({compact=false}:{compact?:boolean}) {
 return <span className={`product-brand ${compact?'product-brand-compact':''}`}>
  <img src="/brand/roadflow-mark.svg" width={compact?32:40} height={compact?32:40} alt=""/>
  <span className="product-brand-name">RoadFlow{!compact&&<span className="product-brand-description">Traffic simulation</span>}</span>
 </span>;
}
