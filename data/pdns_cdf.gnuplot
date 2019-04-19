set term postscript enhanced eps color font "Helvetica,20" size 6in, 3in
set key autotitle columnheader
set output "pdns_cdf.eps"
set datafile commentschars "#%"
set datafile separator ","
set timefmt "%s"
set xlabel "# of cryptojacking domains"
set ylabel "CDF"
set style data points
set autoscale fix
set ytics nomirror  font ",20"
set xlabel font ",20"
set ylabel font ",20"
set grid x y
set logscale x
set yrange [0:1]
set ytics 0,0.1,1

set key bottom right box width -2
set key font ",20"

set for [i=1:3] linetype i pointtype i lw 2

plot "agg_pdns_cdf.data" using 1:2 with lines title "CDF of e2LD + eTLD lookups", \
"pdns_cdf.data" using 1:2 with lines title "CDF of FQDN lookups";
