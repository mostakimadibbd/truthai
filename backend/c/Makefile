# Builds libwatermark.so next to the Python package (app/).
CC ?= gcc
CFLAGS ?= -O2 -fPIC -Wall -Wextra

all: ../app/libwatermark.so

../app/libwatermark.so: watermark.c
	$(CC) $(CFLAGS) -shared -o $@ watermark.c

clean:
	rm -f ../app/libwatermark.so

.PHONY: all clean
